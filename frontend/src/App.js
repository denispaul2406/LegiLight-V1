import React, { useState, useEffect } from 'react';
import './App.css';
import axios from 'axios';
import { Upload, FileText, Shield, DollarSign, Users, MessageCircle, Trash2, Download, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const App = () => {
  const [currentView, setCurrentView] = useState('landing');
  const [documentText, setDocumentText] = useState('');
  const [documentFile, setDocumentFile] = useState(null);
  const [documentName, setDocumentName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [question, setQuestion] = useState('');
  const [questionResponse, setQuestionResponse] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [sampleContracts, setSampleContracts] = useState([]);
  const [healthStatus, setHealthStatus] = useState(null);

  useEffect(() => {
    checkHealthStatus();
    loadSampleContracts();
    loadDocuments();
  }, []);

  const checkHealthStatus = async () => {
    try {
      const response = await axios.get(`${API}/health`);
      setHealthStatus(response.data);
    } catch (error) {
      console.error('Health check failed:', error);
      setHealthStatus({ status: 'error', services: { ai_analysis: false, database: false } });
    }
  };

  const loadSampleContracts = async () => {
    try {
      const response = await axios.get(`${API}/sample-contracts`);
      setSampleContracts(response.data.sample_contracts || []);
    } catch (error) {
      console.error('Failed to load sample contracts:', error);
    }
  };

  const loadDocuments = async () => {
    try {
      const response = await axios.get(`${API}/documents`);
      setDocuments(response.data.documents || []);
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const fileExtension = file.name.split('.').pop().toLowerCase();
      const supportedFormats = ['txt', 'docx', 'pdf'];
      
      if (supportedFormats.includes(fileExtension)) {
        // For non-text files, we'll upload directly to the backend
        if (fileExtension === 'txt') {
          const reader = new FileReader();
          reader.onload = (e) => {
            setDocumentText(e.target.result);
            setDocumentName(file.name);
          };
          reader.readAsText(file);
        } else {
          // For DOCX and PDF, we'll handle them differently
          setDocumentFile(file);
          setDocumentName(file.name);
          setDocumentText(''); // Clear text since we're using file upload
        }
      } else {
        alert('Please upload a supported file format (.txt, .docx, .pdf)');
      }
    }
  };

  const handleSampleContract = (contract) => {
    setDocumentText(contract.text);
    setDocumentName(contract.name);
    setDocumentFile(null); // Clear any uploaded file
    setCurrentView('upload');
  };

  const analyzeDocument = async () => {
    // Check if we have either text or file
    if (!documentText.trim() && !documentFile) {
      alert('Please enter document text or upload a file');
      return;
    }

    setIsAnalyzing(true);
    try {
      let response;
      
      if (documentFile) {
        // Handle file upload
        const formData = new FormData();
        formData.append('file', documentFile);
        formData.append('analysis_type', 'comprehensive');
        
        response = await axios.post(`${API}/analyze/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
      } else {
        // Handle text input
        response = await axios.post(`${API}/analyze/document`, {
          document_text: documentText,
          document_name: documentName || 'Untitled Document',
          analysis_type: 'comprehensive'
        });
      }

      setAnalysisResult(response.data);
      setCurrentView('results');
      setChatHistory([]);
      loadDocuments(); // Refresh document list
    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Analysis failed: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const askQuestion = async () => {
    if (!question.trim() || !analysisResult) return;

    try {
      const response = await axios.post(`${API}/question`, {
        document_id: analysisResult.analysis_id,
        question: question
      });
      
      const newChat = {
        question: question,
        answer: response.data.answer,
        confidence: response.data.confidence,
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatHistory([...chatHistory, newChat]);
      setQuestionResponse(response.data);
      setQuestion('');
    } catch (error) {
      console.error('Question failed:', error);
      alert('Failed to get answer: ' + (error.response?.data?.detail || error.message));
    }
  };

  const deleteDocument = async (analysisId) => {
    try {
      await axios.delete(`${API}/document/${analysisId}`);
      loadDocuments();
      if (analysisResult && analysisResult.analysis_id === analysisId) {
        setAnalysisResult(null);
        setCurrentView('landing');
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete document');
    }
  };

  const getRiskColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'low': return 'text-green-600 bg-green-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'high': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getRiskIcon = (level) => {
    switch (level?.toLowerCase()) {
      case 'low': return <CheckCircle className="w-5 h-5" />;
      case 'medium': return <AlertCircle className="w-5 h-5" />;
      case 'high': return <AlertTriangle className="w-5 h-5" />;
      default: return <AlertCircle className="w-5 h-5" />;
    }
  };

  // Landing Page Component
  const LandingPage = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                LegiLight
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              {healthStatus && (
                <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
                  healthStatus.status === 'healthy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    healthStatus.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
                  }`}></div>
                  <span>{healthStatus.status === 'healthy' ? 'AI Ready' : 'Service Issue'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
            Make Any Contract Crystal Clear in{' '}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              60 Seconds
            </span>
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Transform complex legal documents into plain-language summaries with AI-powered analysis. 
            Understand risks, obligations, and key terms without a law degree.
          </p>
          
          {/* Value Proposition Cards */}
          <div className="flex flex-wrap justify-center gap-6 mb-12">
            <div className="flex items-center space-x-2 px-4 py-2 bg-white rounded-full shadow-md">
              <Shield className="w-5 h-5 text-blue-600" />
              <span className="text-sm font-medium text-gray-700">Privacy-First</span>
            </div>
            <div className="flex items-center space-x-2 px-4 py-2 bg-white rounded-full shadow-md">
              <FileText className="w-5 h-5 text-green-600" />
              <span className="text-sm font-medium text-gray-700">Plain Language</span>
            </div>
            <div className="flex items-center space-x-2 px-4 py-2 bg-white rounded-full shadow-md">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              <span className="text-sm font-medium text-gray-700">Risk Aware</span>
            </div>
          </div>

          <button
            onClick={() => setCurrentView('upload')}
            className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 transform hover:scale-105 shadow-lg"
          >
            <Upload className="w-5 h-5 mr-2" />
            Analyze Your Document
          </button>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-white/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h3 className="text-3xl font-bold text-center text-gray-900 mb-12">How It Works</h3>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-blue-600" />
              </div>
              <h4 className="text-xl font-semibold mb-2">1. Upload</h4>
              <p className="text-gray-600">Upload your contract (.txt, .docx, .pdf) or paste text directly. Multiple formats supported.</p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-green-600" />
              </div>
              <h4 className="text-xl font-semibold mb-2">2. Analyze</h4>
              <p className="text-gray-600">AI reads and analyzes your document, identifying key clauses and risks.</p>
            </div>
            <div className="text-center p-6">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-8 h-8 text-purple-600" />
              </div>
              <h4 className="text-xl font-semibold mb-2">3. Understand</h4>
              <p className="text-gray-600">Get plain-language summaries and ask questions about specific clauses.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Sample Contracts */}
      {sampleContracts.length > 0 && (
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <h3 className="text-3xl font-bold text-center text-gray-900 mb-8">Try Sample Contracts</h3>
            <div className="grid md:grid-cols-2 gap-6">
              {sampleContracts.map((contract) => (
                <div key={contract.id} className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-shadow">
                  <h4 className="text-xl font-semibold mb-2">{contract.name}</h4>
                  <p className="text-gray-600 mb-4">{contract.description}</p>
                  <button
                    onClick={() => handleSampleContract(contract)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Analyze Sample
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-gray-400 mb-4">
            <strong>Disclaimer:</strong> LegiLight provides informational analysis only and does not constitute legal advice. 
            Always consult with qualified legal professionals for legal matters.
          </p>
          <p className="text-sm text-gray-500">
            Built for Google Cloud GenAI Exchange Hackathon 2025
          </p>
        </div>
      </footer>
    </div>
  );

  // Upload Component
  const UploadView = () => (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Document Analysis</h2>
            <button
              onClick={() => setCurrentView('landing')}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              ← Back to Home
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Document Name
              </label>
              <input
                type="text"
                value={documentName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder="Enter document name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload Document or Paste Text
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".txt,.docx,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-sm text-gray-600 mb-2">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">
                    Supports: .txt, .docx, .pdf files
                  </p>
                </label>
                
                {documentFile && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-800">
                      📄 Selected: {documentFile.name}
                    </p>
                    <button
                      onClick={() => {
                        setDocumentFile(null);
                        setDocumentName('');
                      }}
                      className="mt-2 text-xs text-red-600 hover:text-red-800"
                    >
                      Remove file
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or paste document text directly
              </label>
              <textarea
                value={documentText}
                onChange={(e) => {
                  setDocumentText(e.target.value);
                  if (e.target.value.trim()) {
                    setDocumentFile(null); // Clear file if user types text
                  }
                }}
                placeholder={documentFile ? "File selected for analysis. You can still paste text here to override." : "Paste your legal document text here..."}
                rows={15}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={documentFile && !documentText}
              />
              {documentFile && !documentText && (
                <p className="mt-2 text-sm text-gray-500">
                  📁 File ready for analysis. Text extraction will happen automatically.
                </p>
              )}
            </div>

            <button
              onClick={analyzeDocument}
              disabled={isAnalyzing || (!documentText.trim() && !documentFile)}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isAnalyzing ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  {documentFile ? 'Processing File...' : 'Analyzing Document...'}
                </div>
              ) : (
                `Analyze ${documentFile ? 'File' : 'Document'}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Results Component
  const ResultsView = () => (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Analysis Results</h2>
          <div className="flex space-x-4">
            <button
              onClick={() => setCurrentView('upload')}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              ← New Analysis
            </button>
            <button
              onClick={() => setCurrentView('landing')}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              Home
            </button>
          </div>
        </div>

        {analysisResult && (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Main Analysis */}
            <div className="lg:col-span-2 space-y-6">
              {/* Document Summary */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center mb-4">
                  <FileText className="w-6 h-6 text-blue-600 mr-2" />
                  <h3 className="text-xl font-semibold">Document Summary</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Document Type</p>
                    <p className="font-medium">{analysisResult.document_summary?.document_type || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Main Purpose</p>
                    <p className="font-medium">{analysisResult.document_summary?.main_purpose || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Key Parties</p>
                    <p className="font-medium">
                      {analysisResult.document_summary?.key_parties?.join(', ') || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">AI Confidence</p>
                    <p className="font-medium">{Math.round(analysisResult.ai_confidence * 100)}%</p>
                  </div>
                </div>
              </div>

              {/* Risk Assessment */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center mb-4">
                  <div className={`flex items-center space-x-2 ${getRiskColor(analysisResult.risk_assessment?.overall_risk_level)} px-3 py-1 rounded-lg`}>
                    {getRiskIcon(analysisResult.risk_assessment?.overall_risk_level)}
                    <span className="font-semibold">
                      {analysisResult.risk_assessment?.overall_risk_level || 'Unknown'} Risk Level
                    </span>
                  </div>
                </div>
                
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <h4 className="font-medium text-red-600 mb-2">Red Flags</h4>
                    <ul className="text-sm space-y-1">
                      {analysisResult.risk_assessment?.red_flags?.map((flag, index) => (
                        <li key={index} className="flex items-start">
                          <AlertTriangle className="w-4 h-4 text-red-500 mr-1 mt-0.5 flex-shrink-0" />
                          {flag}
                        </li>
                      )) || <li className="text-gray-500">None identified</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-yellow-600 mb-2">Yellow Flags</h4>
                    <ul className="text-sm space-y-1">
                      {analysisResult.risk_assessment?.yellow_flags?.map((flag, index) => (
                        <li key={index} className="flex items-start">
                          <AlertCircle className="w-4 h-4 text-yellow-500 mr-1 mt-0.5 flex-shrink-0" />
                          {flag}
                        </li>
                      )) || <li className="text-gray-500">None identified</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-green-600 mb-2">Green Flags</h4>
                    <ul className="text-sm space-y-1">
                      {analysisResult.risk_assessment?.green_flags?.map((flag, index) => (
                        <li key={index} className="flex items-start">
                          <CheckCircle className="w-4 h-4 text-green-500 mr-1 mt-0.5 flex-shrink-0" />
                          {flag}
                        </li>
                      )) || <li className="text-gray-500">None identified</li>}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Financial Terms */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center mb-4">
                  <DollarSign className="w-6 h-6 text-green-600 mr-2" />
                  <h3 className="text-xl font-semibold">Financial Terms</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Payment Amounts</h4>
                    <ul className="text-sm space-y-1">
                      {analysisResult.financial_terms?.payment_amounts?.map((amount, index) => (
                        <li key={index}>{amount}</li>
                      )) || <li className="text-gray-500">None specified</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Penalties & Fees</h4>
                    <ul className="text-sm space-y-1">
                      {analysisResult.financial_terms?.penalties?.concat(analysisResult.financial_terms?.fees || [])?.map((item, index) => (
                        <li key={index}>{item}</li>
                      )) || <li className="text-gray-500">None specified</li>}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Obligations */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center mb-4">
                  <Users className="w-6 h-6 text-purple-600 mr-2" />
                  <h3 className="text-xl font-semibold">Key Obligations</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Your Obligations</h4>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {analysisResult.obligations?.party_1_obligations?.map((obligation, index) => (
                        <li key={index}>{obligation}</li>
                      )) || <li className="text-gray-500">None specified</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Other Party's Obligations</h4>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {analysisResult.obligations?.party_2_obligations?.map((obligation, index) => (
                        <li key={index}>{obligation}</li>
                      )) || <li className="text-gray-500">None specified</li>}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Key Clauses */}
              {analysisResult.key_clauses && analysisResult.key_clauses.length > 0 && (
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-xl font-semibold mb-4">Key Clauses</h3>
                  <div className="space-y-4">
                    {analysisResult.key_clauses.map((clause, index) => (
                      <div key={index} className="border-l-4 border-blue-500 pl-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium capitalize">{clause.clause_type}</h4>
                          <span className={`px-2 py-1 rounded text-xs ${
                            clause.importance === 'High' ? 'bg-red-100 text-red-800' :
                            clause.importance === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {clause.importance} Priority
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{clause.plain_language}</p>
                        <details className="text-xs text-gray-500">
                          <summary className="cursor-pointer hover:text-gray-700">View original text</summary>
                          <p className="mt-2 p-2 bg-gray-50 rounded">{clause.clause_text}</p>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Q&A Sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-lg p-6 sticky top-8">
                <div className="flex items-center mb-4">
                  <MessageCircle className="w-6 h-6 text-indigo-600 mr-2" />
                  <h3 className="text-xl font-semibold">Ask Questions</h3>
                </div>
                
                <div className="space-y-4">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ask about this document..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      onKeyPress={(e) => e.key === 'Enter' && askQuestion()}
                    />
                    <button
                      onClick={askQuestion}
                      disabled={!question.trim()}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Ask
                    </button>
                  </div>

                  {/* Chat History */}
                  <div className="max-h-96 overflow-y-auto space-y-3">
                    {chatHistory.map((chat, index) => (
                      <div key={index} className="border-b border-gray-100 pb-3 last:border-b-0">
                        <div className="bg-indigo-50 p-3 rounded-lg mb-2">
                          <p className="text-sm font-medium text-indigo-900">Q: {chat.question}</p>
                        </div>
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-sm text-gray-800">{chat.answer}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-gray-500">
                              Confidence: {Math.round(chat.confidence * 100)}%
                            </span>
                            <span className="text-xs text-gray-500">{chat.timestamp}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {chatHistory.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                      <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Ask questions about this document</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Render current view
  const renderCurrentView = () => {
    switch (currentView) {
      case 'upload':
        return <UploadView />;
      case 'results':
        return <ResultsView />;
      default:
        return <LandingPage />;
    }
  };

  return renderCurrentView();
};

export default App;