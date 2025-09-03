from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, validator
from typing import List, Dict, Optional, Union, Any
import uuid
from datetime import datetime
import time
import asyncio
import re
import hashlib
from bson import ObjectId
import json
from io import BytesIO
import traceback

# Document parsing libraries
try:
    from docx import Document
    import docx2txt
    print("✓ DOCX parsing libraries loaded successfully")
except ImportError as e:
    print(f"✗ Failed to import DOCX libraries: {e}")
    Document, docx2txt = None, None

try:
    import PyPDF2
    print("✓ PDF parsing library loaded successfully")
except ImportError as e:
    print(f"✗ Failed to import PDF library: {e}")
    PyPDF2 = None

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Import AI integration libraries
try:
    import google.generativeai as genai
    print("✓ Google Generative AI library loaded successfully")
except ImportError as e:
    print(f"✗ Failed to import google.generativeai: {e}")
    genai = None

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI(
    title="LegiLight - AI Legal Document Analysis",
    description="Transform complex legal documents into plain-language summaries with AI-powered analysis",
    version="1.0.0"
)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Utility function to convert MongoDB documents for JSON serialization
def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable format"""
    if isinstance(doc, dict):
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                doc[key] = str(value)
            elif isinstance(value, dict):
                doc[key] = serialize_doc(value)
            elif isinstance(value, list):
                doc[key] = [serialize_doc(item) if isinstance(item, dict) else str(item) if isinstance(item, ObjectId) else item for item in value]
    return doc

# Pydantic Models
class DocumentUploadRequest(BaseModel):
    document_text: str = Field(..., min_length=10, max_length=100000)
    document_name: Optional[str] = Field(default="Untitled Document")
    analysis_type: str = Field(default="comprehensive", pattern="^(comprehensive|risk_assessment|clause_extraction)$")
    
    @validator('document_text')
    def validate_document_text(cls, v):
        if not v.strip():
            raise ValueError('Document text cannot be empty')
        return v.strip()

class DocumentFileUploadRequest(BaseModel):
    document_name: Optional[str] = Field(default="Untitled Document")
    analysis_type: str = Field(default="comprehensive", pattern="^(comprehensive|risk_assessment|clause_extraction)$")

class DocumentAnalysisResponse(BaseModel):
    success: bool
    analysis_id: str
    document_summary: Dict[str, Any]
    risk_assessment: Dict[str, Any]
    financial_terms: Dict[str, Any]
    obligations: Dict[str, Any]
    key_clauses: List[Dict[str, Any]]
    processing_time: float
    ai_confidence: float

class QuestionRequest(BaseModel):
    document_id: str
    question: str = Field(..., min_length=5, max_length=500)

class QuestionResponse(BaseModel):
    success: bool
    answer: str
    confidence: float
    relevant_clauses: List[str]

# Document Parsing Service
class DocumentParsingService:
    """Service to parse different document formats"""
    
    @staticmethod
    def extract_text_from_docx(file_content: bytes) -> str:
        """Extract text from DOCX file"""
        try:
            if not docx2txt:
                raise ImportError("DOCX parsing library not available")
            
            # Use docx2txt for simple text extraction
            text = docx2txt.process(BytesIO(file_content))
            
            if not text.strip():
                # Fallback to python-docx for more detailed extraction
                if Document:
                    doc = Document(BytesIO(file_content))
                    paragraphs = []
                    for paragraph in doc.paragraphs:
                        if paragraph.text.strip():
                            paragraphs.append(paragraph.text)
                    text = '\n'.join(paragraphs)
            
            return text.strip()
        except Exception as e:
            logger.error(f"Failed to extract text from DOCX: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to parse DOCX file: {str(e)}")
    
    @staticmethod
    def extract_text_from_pdf(file_content: bytes) -> str:
        """Extract text from PDF file"""
        try:
            if not PyPDF2:
                raise ImportError("PDF parsing library not available")
            
            pdf_reader = PyPDF2.PdfReader(BytesIO(file_content))
            text_parts = []
            
            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]
                text = page.extract_text()
                if text.strip():
                    text_parts.append(text)
            
            extracted_text = '\n'.join(text_parts)
            return extracted_text.strip()
        except Exception as e:
            logger.error(f"Failed to extract text from PDF: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to parse PDF file: {str(e)}")
    
    @staticmethod
    def extract_text_from_doc(file_content: bytes) -> str:
        """Extract text from DOC file (legacy format)"""
        # For DOC files, we'll suggest users convert to DOCX
        # As DOC parsing is more complex and requires additional libraries
        raise HTTPException(
            status_code=400, 
            detail="DOC files are not directly supported. Please convert to DOCX format or copy the text directly."
        )
    
    @staticmethod
    async def parse_uploaded_file(file: UploadFile) -> str:
        """Parse uploaded file and extract text based on file type"""
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")
        
        # Read file content
        file_content = await file.read()
        
        if not file_content:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
        
        # Get file extension
        file_extension = Path(file.filename).suffix.lower()
        
        # Parse based on file type
        if file_extension == '.txt':
            try:
                return file_content.decode('utf-8').strip()
            except UnicodeDecodeError:
                try:
                    return file_content.decode('latin-1').strip()
                except UnicodeDecodeError:
                    raise HTTPException(status_code=400, detail="Unable to decode text file")
        
        elif file_extension == '.docx':
            return DocumentParsingService.extract_text_from_docx(file_content)
        
        elif file_extension == '.pdf':
            return DocumentParsingService.extract_text_from_pdf(file_content)
        
        elif file_extension == '.doc':
            return DocumentParsingService.extract_text_from_doc(file_content)
        
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported file format: {file_extension}. Supported formats: .txt, .docx, .pdf"
            )

# AI Integration Service
class LegiLightAIService:
    def __init__(self):
        self.gemini_api_key = os.environ.get('GEMINI_API_KEY')
        
        if not self.gemini_api_key:
            logger.error("GEMINI_API_KEY not found in environment variables")
            raise ValueError("AI service not properly configured")
        
        # Initialize Gemini Pro
        self.model = None
        self._initialize_ai_service()
    
    def _initialize_ai_service(self):
        """Initialize the AI service with Gemini Pro"""
        try:
            if genai:
                genai.configure(api_key=self.gemini_api_key)
                self.model = genai.GenerativeModel(
                    model_name="gemini-2.5-flash",
                    system_instruction="""You are a legal AI assistant specializing in contract analysis. 
                    Your role is to:
                    1. Analyze legal documents and extract key information
                    2. Identify risks, obligations, and important clauses
                    3. Provide plain-language explanations of complex legal terms
                    4. Answer questions about specific contract provisions
                    
                    Always provide accurate, helpful analysis while noting that this is not legal advice."""
                )
                
                logger.info("✓ Gemini Pro AI service initialized successfully")
            else:
                logger.error("✗ AI service libraries not available")
                
        except Exception as e:
            logger.error(f"Failed to initialize AI service: {e}")
            raise
    
    async def analyze_document_comprehensive(self, document_text: str, document_name: str) -> Dict[str, Any]:
        """Comprehensive legal document analysis using Gemini Pro"""
        try:
            analysis_prompt = f"""
            Please analyze this legal document: "{document_name}"
            
            Document Text:
            {document_text}
            
            Provide a comprehensive analysis in the following JSON format:
            {{
                "document_summary": {{
                    "document_type": "contract type (e.g., Employment Agreement, Service Agreement)",
                    "key_parties": ["Party 1", "Party 2"],
                    "main_purpose": "Brief description of the agreement's purpose",
                    "effective_date": "date if mentioned",
                    "expiration_date": "date if mentioned"
                }},
                "risk_assessment": {{
                    "overall_risk_level": "Low/Medium/High",
                    "red_flags": ["List of concerning clauses"],
                    "yellow_flags": ["List of clauses needing attention"],
                    "green_flags": ["List of favorable clauses"]
                }},
                "financial_terms": {{
                    "payment_amounts": ["Any monetary amounts mentioned"],
                    "payment_schedules": ["Payment timing details"],
                    "penalties": ["Financial penalties or liquidated damages"],
                    "fees": ["Any fees mentioned"]
                }},
                "obligations": {{
                    "party_1_obligations": ["What first party must do"],
                    "party_2_obligations": ["What second party must do"],
                    "mutual_obligations": ["Shared responsibilities"]
                }},
                "key_clauses": [
                    {{
                        "clause_type": "termination/liability/confidentiality/etc",
                        "clause_text": "Actual clause text",
                        "plain_language": "Simple explanation",
                        "importance": "High/Medium/Low"
                    }}
                ],
                "ai_confidence": 0.85
            }}
            
            Make sure to provide accurate, detailed analysis. Focus on practical implications for non-lawyers.
            """
            
            start_time = time.time()
            
            # Generate response using Gemini
            response = await asyncio.get_event_loop().run_in_executor(
                None, 
                lambda: self.model.generate_content(analysis_prompt)
            )
            
            processing_time = time.time() - start_time
            response_text = response.text
            
            # Parse JSON response
            try:
                # Clean the response to extract JSON
                json_start = response_text.find('{')
                json_end = response_text.rfind('}') + 1
                
                if json_start != -1 and json_end > json_start:
                    json_text = response_text[json_start:json_end]
                    analysis_result = json.loads(json_text)
                    analysis_result['processing_time'] = processing_time
                    return analysis_result
                else:
                    # Fallback parsing
                    return self._create_fallback_analysis(document_text, document_name, processing_time)
                    
            except json.JSONDecodeError:
                logger.warning("Failed to parse AI response as JSON, using fallback")
                return self._create_fallback_analysis(document_text, document_name, processing_time)
                
        except Exception as e:
            logger.error(f"AI analysis failed: {e}")
            return self._create_error_analysis(str(e))
    
    async def answer_question(
        self, 
        document_text: str, 
        question: str, 
        previous_analysis: Dict = None
    ) -> Dict[str, Any]:
        """Answer specific questions about the document"""
        try:
            context = ""
            if previous_analysis:
                context = f"Previous analysis context: {json.dumps(previous_analysis.get('document_summary', {}), indent=2)}"
            
            qa_prompt = f"""
            Based on this legal document, please answer the user's question:
            
            Document Text:
            {document_text}
            
            {context}
            
            User Question: {question}
            
            Please respond in JSON format:
            {{
                "answer": "Direct answer to the question",
                "confidence": 0.85,
                "relevant_clauses": ["Specific clauses that support this answer"],
                "additional_context": "Any additional relevant information"
            }}
            
            Provide a clear, accurate answer based on the document content.
            """
            
            # Generate response using Gemini
            response = await asyncio.get_event_loop().run_in_executor(
                None, 
                lambda: self.model.generate_content(qa_prompt)
            )
            
            response_text = response.text
            
            # Parse JSON response
            try:
                json_start = response_text.find('{')
                json_end = response_text.rfind('}') + 1
                
                if json_start != -1 and json_end > json_start:
                    json_text = response_text[json_start:json_end]
                    return json.loads(json_text)
                else:
                    return {
                        "answer": response_text,
                        "confidence": 0.7,
                        "relevant_clauses": ["Unable to extract specific clauses"],
                        "additional_context": "Full AI response provided"
                    }
                    
            except json.JSONDecodeError:
                return {
                    "answer": response_text,
                    "confidence": 0.6,
                    "relevant_clauses": ["JSON parsing failed"],
                    "additional_context": "Raw AI response"
                }
                
        except Exception as e:
            logger.error(f"Question answering failed: {e}")
            return {
                "answer": f"Error processing question: {str(e)}",
                "confidence": 0.0,
                "relevant_clauses": [],
                "additional_context": "Error occurred during processing"
            }
    
    def _create_fallback_analysis(self, document_text: str, document_name: str, processing_time: float) -> Dict[str, Any]:
        """Create fallback analysis using pattern matching"""
        patterns = {
            "parties": re.findall(r'between\s+([^,\n]+)\s+and\s+([^,\n]+)', document_text, re.IGNORECASE),
            "dates": re.findall(r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\w+\s+\d{1,2},?\s+\d{4}\b', document_text),
            "monetary": re.findall(r'\$[\d,]+(?:\.\d{2})?', document_text),
            "termination": re.findall(r'terminat\w*|expir\w*|end\s+of\s+agreement', document_text, re.IGNORECASE)
        }
        
        return {
            "document_summary": {
                "document_type": "Legal Document",
                "key_parties": [p[0].strip() for p in patterns["parties"][:2]] if patterns["parties"] else ["Party 1", "Party 2"],
                "main_purpose": "Document analysis using pattern matching",
                "effective_date": patterns["dates"][0] if patterns["dates"] else "Not specified",
                "expiration_date": "Not specified"
            },
            "risk_assessment": {
                "overall_risk_level": "Medium",
                "red_flags": ["AI analysis unavailable - manual review recommended"],
                "yellow_flags": ["Document requires legal review"],
                "green_flags": []
            },
            "financial_terms": {
                "payment_amounts": patterns["monetary"][:5],
                "payment_schedules": [],
                "penalties": [],
                "fees": []
            },
            "obligations": {
                "party_1_obligations": ["Pattern matching analysis - details limited"],
                "party_2_obligations": ["Pattern matching analysis - details limited"],
                "mutual_obligations": []
            },
            "key_clauses": [
                {
                    "clause_type": "general",
                    "clause_text": "Pattern-based analysis performed",
                    "plain_language": "AI analysis was unavailable, using basic pattern matching",
                    "importance": "Medium"
                }
            ],
            "ai_confidence": 0.4,
            "processing_time": processing_time
        }
    
    def _create_error_analysis(self, error_message: str) -> Dict[str, Any]:
        """Create error analysis response"""
        return {
            "document_summary": {
                "document_type": "Analysis Error",
                "key_parties": [],
                "main_purpose": f"Error occurred: {error_message}",
                "effective_date": "N/A",
                "expiration_date": "N/A"
            },
            "risk_assessment": {
                "overall_risk_level": "Unknown",
                "red_flags": ["Document analysis failed"],
                "yellow_flags": ["Please try again or contact support"],
                "green_flags": []
            },
            "financial_terms": {
                "payment_amounts": [],
                "payment_schedules": [],
                "penalties": [],
                "fees": []
            },
            "obligations": {
                "party_1_obligations": [],
                "party_2_obligations": [],
                "mutual_obligations": []
            },
            "key_clauses": [],
            "ai_confidence": 0.0,
            "processing_time": 0.0
        }

# Initialize AI service
try:
    ai_service = LegiLightAIService()
    logger.info("✓ LegiLight AI Service initialized")
except Exception as e:
    logger.error(f"✗ Failed to initialize AI service: {e}")
    ai_service = None

# API Routes
@api_router.get("/")
async def root():
    return {"message": "LegiLight API - Transform legal complexity into clarity"}

@api_router.get("/health")
async def health_check():
    """Health check endpoint"""
    ai_status = ai_service is not None and ai_service.model is not None
    
    return {
        "status": "healthy",
        "services": {
            "ai_analysis": ai_status,
            "database": True,
            "timestamp": datetime.utcnow().isoformat()
        }
    }

@api_router.post("/analyze/document", response_model=DocumentAnalysisResponse)
async def analyze_document(request: DocumentUploadRequest):
    """Analyze legal document and extract key information"""
    if not ai_service:
        raise HTTPException(status_code=503, detail="AI service not available")
    
    start_time = time.time()
    analysis_id = f"analysis_{int(time.time() * 1000)}"
    
    try:
        # Perform comprehensive analysis
        analysis_result = await ai_service.analyze_document_comprehensive(
            request.document_text, 
            request.document_name
        )
        
        # Store analysis in database
        document_record = {
            "analysis_id": analysis_id,
            "document_name": request.document_name,
            "document_text": request.document_text[:1000] + "..." if len(request.document_text) > 1000 else request.document_text,
            "analysis_result": analysis_result,
            "created_at": datetime.utcnow(),
            "analysis_type": request.analysis_type
        }
        
        await db.document_analyses.insert_one(document_record)
        
        total_processing_time = time.time() - start_time
        
        return DocumentAnalysisResponse(
            success=True,
            analysis_id=analysis_id,
            document_summary=analysis_result.get("document_summary", {}),
            risk_assessment=analysis_result.get("risk_assessment", {}),
            financial_terms=analysis_result.get("financial_terms", {}),
            obligations=analysis_result.get("obligations", {}),
            key_clauses=analysis_result.get("key_clauses", []),
            processing_time=total_processing_time,
            ai_confidence=analysis_result.get("ai_confidence", 0.0)
        )
        
    except Exception as e:
        logger.error(f"Document analysis failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@api_router.post("/analyze/upload", response_model=DocumentAnalysisResponse)
async def analyze_uploaded_document(
    file: UploadFile = File(...),
    analysis_type: str = "comprehensive"
):
    """Analyze uploaded document file (DOCX, PDF, TXT)"""
    if not ai_service:
        raise HTTPException(status_code=503, detail="AI service not available")
    
    start_time = time.time()
    analysis_id = f"analysis_{int(time.time() * 1000)}"
    
    try:
        # Parse the uploaded file
        document_text = await DocumentParsingService.parse_uploaded_file(file)
        
        if len(document_text) < 10:
            raise HTTPException(status_code=400, detail="Document text too short (minimum 10 characters)")
        
        if len(document_text) > 100000:
            raise HTTPException(status_code=400, detail="Document text too long (maximum 100,000 characters)")
        
        # Perform comprehensive analysis
        analysis_result = await ai_service.analyze_document_comprehensive(
            document_text, 
            file.filename or "Uploaded Document"
        )
        
        # Store analysis in database
        document_record = {
            "analysis_id": analysis_id,
            "document_name": file.filename or "Uploaded Document",
            "document_text": document_text[:1000] + "..." if len(document_text) > 1000 else document_text,
            "analysis_result": analysis_result,
            "created_at": datetime.utcnow(),
            "analysis_type": analysis_type,
            "file_type": Path(file.filename).suffix.lower() if file.filename else "unknown"
        }
        
        await db.document_analyses.insert_one(document_record)
        
        total_processing_time = time.time() - start_time
        
        return DocumentAnalysisResponse(
            success=True,
            analysis_id=analysis_id,
            document_summary=analysis_result.get("document_summary", {}),
            risk_assessment=analysis_result.get("risk_assessment", {}),
            financial_terms=analysis_result.get("financial_terms", {}),
            obligations=analysis_result.get("obligations", {}),
            key_clauses=analysis_result.get("key_clauses", []),
            processing_time=total_processing_time,
            ai_confidence=analysis_result.get("ai_confidence", 0.0)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Document analysis failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@api_router.post("/question", response_model=QuestionResponse)
async def ask_question(request: QuestionRequest):
    """Ask a question about a previously analyzed document"""
    if not ai_service:
        raise HTTPException(status_code=503, detail="AI service not available")
    
    try:
        # Retrieve document from database
        document_record = await db.document_analyses.find_one({"analysis_id": request.document_id})
        
        if not document_record:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Get answer from AI
        answer_result = await ai_service.answer_question(
            document_record["document_text"],
            request.question,
            document_record.get("analysis_result")
        )
        
        return QuestionResponse(
            success=True,
            answer=answer_result.get("answer", "Unable to provide answer"),
            confidence=answer_result.get("confidence", 0.0),
            relevant_clauses=answer_result.get("relevant_clauses", [])
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Question answering failed: {e}")
        raise HTTPException(status_code=500, detail=f"Question processing failed: {str(e)}")

@api_router.get("/documents")
async def get_documents():
    """Get list of analyzed documents"""
    try:
        documents = await db.document_analyses.find(
            {}, 
            {
                "analysis_id": 1, 
                "document_name": 1, 
                "created_at": 1, 
                "analysis_type": 1
            }
        ).sort("created_at", -1).limit(50).to_list(50)
        
        # Convert ObjectId to string for JSON serialization
        serialized_documents = [serialize_doc(doc) for doc in documents]
        
        return {
            "success": True,
            "documents": serialized_documents
        }
        
    except Exception as e:
        logger.error(f"Failed to retrieve documents: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve documents")

@api_router.delete("/document/{analysis_id}")
async def delete_document(analysis_id: str):
    """Delete a document and its analysis"""
    try:
        result = await db.document_analyses.delete_one({"analysis_id": analysis_id})
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return {"success": True, "message": "Document deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete document: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")

@api_router.get("/sample-contracts")
async def get_sample_contracts():
    """Get sample contracts for demo purposes"""
    sample_contracts = [
        {
            "id": "sample_1",
            "name": "Employment Agreement Sample",
            "description": "Standard employment contract with common clauses",
            "text": """EMPLOYMENT AGREEMENT

This Employment Agreement ("Agreement") is entered into as of January 1, 2025, between TechCorp Inc., a Delaware corporation ("Company"), and Jane Smith ("Employee").

1. POSITION AND DUTIES
Employee will serve as Senior Software Engineer and will perform duties as assigned by Company.

2. COMPENSATION
Company will pay Employee a base salary of $120,000 per year, payable in accordance with Company's regular payroll practices.

3. TERMINATION
Either party may terminate this Agreement at any time, with or without cause, by providing thirty (30) days written notice to the other party.

4. CONFIDENTIALITY
Employee acknowledges that during employment, Employee may have access to confidential information including trade secrets, customer lists, and proprietary technology.

5. LIABILITY LIMITATION
In no event shall Company's liability exceed the total compensation paid to Employee in the twelve (12) months preceding the claim, except in cases of willful misconduct.

6. GOVERNING LAW
This Agreement shall be governed by the laws of the State of Delaware."""
        },
        {
            "id": "sample_2", 
            "name": "Service Agreement Sample",
            "description": "Professional services contract with payment terms",
            "text": """SERVICE AGREEMENT

This Service Agreement ("Agreement") is made on March 15, 2025, between WebDesign LLC ("Provider") and StartupCo Inc. ("Client").

1. SERVICES
Provider agrees to provide web development services including design, development, and deployment of Client's website.

2. PAYMENT TERMS
Client agrees to pay Provider $25,000 for the services, with 50% due upon signing and 50% due upon completion.

3. TIMELINE
Services will be completed within 8 weeks from the start date.

4. INTELLECTUAL PROPERTY
All work product created by Provider will become the exclusive property of Client upon final payment.

5. LIMITATION OF LIABILITY
Provider's total liability shall not exceed the total amount paid by Client under this Agreement.

6. TERMINATION FOR CONVENIENCE
Either party may terminate this Agreement with 14 days written notice."""
        }
    ]
    
    return {
        "success": True,
        "sample_contracts": sample_contracts
    }

# Include the router in the main app
app.include_router(api_router)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # Specific frontend origins
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)