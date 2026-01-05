import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Mic, Clock, CheckCircle, ChevronRight, FileAudio, AlertCircle, Download, RefreshCw, Loader2, FolderOpen, BookOpen, Sparkles, BrainCircuit, Flag, Printer, Key, Save, Square, ImageIcon, FileText, Settings2, SkipForward } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { TEST_SETS, loadExamData } from './constants';
import { TestPhase, RecordingMap, Question, Section } from './types';
import { Waveform } from './components/Waveform';

const App: React.FC = () => {
  // --- State ---
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  
  // API Key & Settings State
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [modelList, setModelList] = useState<string[]>(['gemini-3-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash']); // Defaults
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  
  // Data State
  const [examData, setExamData] = useState<Section[] | null>(null);
  const [currentTestName, setCurrentTestName] = useState<string>('');
  const [loadingTest, setLoadingTest] = useState<boolean>(false);
  const [preloadStatus, setPreloadStatus] = useState<{current: number, total: number, file: string} | null>(null);

  // Exam Progress State
  const [currentSectionIndex, setCurrentSectionIndex] = useState<number>(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [phase, setPhase] = useState<TestPhase>(TestPhase.IDLE);
  const [timer, setTimer] = useState<number>(0);
  const [recordings, setRecordings] = useState<RecordingMap>({});
  
  // Grading State
  const [gradingResults, setGradingResults] = useState<Record<string, { score: number, feedback: string, loading: boolean }>>({});
  const [isBatchGrading, setIsBatchGrading] = useState<boolean>(false);
  
  // Media State
  const [mediaIndex, setMediaIndex] = useState<number>(0);
  
  // --- Refs for logic ---
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // --- Derived State ---
  const currentSection = examData ? examData[currentSectionIndex] : null;
  const currentQuestion = currentSection?.questions[currentQuestionIndex];
  const isLastQuestionOfSection = currentSection && currentQuestionIndex === currentSection.questions.length - 1;
  const isLastSection = examData && currentSectionIndex === examData.length - 1;

  // --- Point Map ---
  const SECTION_POINTS: Record<string, number> = {
    'q1_1': 0.5, 'q1_2': 0.5, // Sec 1: 1.0 total
    'q2_1': 1.0,              // Sec 2: 1.0 total
    'q3_1': 1.0, 'q3_2': 1.0, // Sec 3: 2.0 total
    'q4_1': 1.5,              // Sec 4: 1.5 total
    'q5_1': 0.5, 'q5_2': 0.5, 'q5_3': 0.5, 'q5_4': 0.5, // Sec 5: 2.0 total
    'q6_1': 1.0, 'q6_2': 1.5  // Sec 6: 2.5 total
  }; // Sum = 10.0

  // --- Initialization & API Key ---
  useEffect(() => {
    const storedKey = localStorage.getItem('GEMINI_API_KEY');
    if (storedKey) {
      setApiKey(storedKey);
      fetchModels(storedKey);
    }
    const storedModel = localStorage.getItem('GEMINI_MODEL');
    if (storedModel) {
      setSelectedModel(storedModel);
    }
  }, []);

  const fetchModels = async (key: string) => {
    setLoadingModels(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const data = await response.json();
      if (data.models) {
        // Filter models suitable for generation
        const models = data.models
          .map((m: any) => m.name.replace('models/', ''))
          .filter((n: string) => n.includes('gemini') || n.includes('flash') || n.includes('pro'));
        
        if (models.length > 0) {
          setModelList(models);
          // If current selected model is not in list, fallback to first one or default
          if (!models.includes(selectedModel)) {
            // Keep user preference if possible, otherwise default to first available
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    } finally {
      setLoadingModels(false);
    }
  };

  const saveSettings = () => {
    if (apiKey.trim().length > 0) {
      localStorage.setItem('GEMINI_API_KEY', apiKey);
      localStorage.setItem('GEMINI_MODEL', selectedModel);
      setShowApiKeyModal(false);
      setApiError('');
    } else {
      setApiError('Please enter a valid API Key');
    }
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    if (e.target.value.length > 30) {
        fetchModels(e.target.value);
    }
  }

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setHasPermission(true);
    } catch (err) {
      console.error('Microphone permission denied:', err);
      alert('Please allow microphone access to take the test.');
    }
  };

  // --- Audio Helper ---
  const playAudio = (path: string) => {
    const audio = new Audio(path);
    audio.play().catch(e => console.error("Failed to play audio:", e));
  };

  // --- Clean Text Helper ---
  const cleanHtmlText = (text: string) => {
    if (!text) return '';
    return text
      .replace(/<br\s*\/?>/gi, '\n') // Replace <br>, <br/>, <br /> with newline
      .replace(/<\/?p>/gi, '') // Remove <p> and </p>
      .trim();
  };

  // --- AI Grading Logic ---
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const base64Data = base64String.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const urlToBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return blobToBase64(blob);
  }

  const handleGrade = async (question: Question, sectionId: string, blob: Blob) => {
    // API Key Check
    if (!apiKey) {
      setShowApiKeyModal(true);
      return;
    }

    const qId = question.id;
    const maxScore = SECTION_POINTS[qId] || 10; // Default to 10 if not found, but should be found
    
    setGradingResults(prev => ({ ...prev, [qId]: { score: 0, feedback: '', loading: true } }));

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const base64Audio = await blobToBase64(blob);

      let prompt = `You are an expert English oral test examiner for the Chinese Shanghai Gaokao. `;
      const parts: any[] = [];
      const gradingContext = question.gradingContext || {};
      const promptText = cleanHtmlText(question.promptText);

      // Common Prompt Suffix
      const promptSuffix = `
        IMPORTANT: The maximum score for this question is ${maxScore} points.
        Provide a score strictly between 0 and ${maxScore} (e.g., 0.5, 1.2, ${maxScore}).
        Provide concise feedback in Chinese.
      `;

      // --- SECTION 1 & 2: READING ---
      if (sectionId === 'sec_1' || sectionId === 'sec_2') {
        prompt += `
          Task: Read Aloud.
          Original Text: "${promptText}"
          
          Grading Criteria:
          1. Pronunciation: Check accuracy. NOTE: If the student corrects themselves (repeats a word), grade based on the *corrected* version.
          2. Intonation & Stress.
          3. Fluency.
          ${sectionId === 'sec_2' ? '4. Completeness: If the student does not finish reading the whole paragraph due to time limit, DO NOT deduct points for the unread part.' : ''}
          ${promptSuffix}
        `;
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: 'audio/webm', data: base64Audio } });
      } 
      
      // --- SECTION 3: SITUATION Q&A ---
      else if (sectionId === 'sec_3') {
        const refAnswer = cleanHtmlText(gradingContext.refAnswers ? gradingContext.refAnswers[0] : question.answerContent);
        
        prompt += `
          Task: Situation Q&A. The student asks questions based on a prompt.
          Prompt Info: "${promptText}"
          Reference Answer (First valid option): "${refAnswer}"

          Grading Criteria:
          1. Grammar: Check for grammatical correctness in forming questions.
          2. Content: The question must be relevant to the prompt context.
          3. SPECIAL RULE: There are two questions in this section. At least ONE of the questions (across the whole section) must be a Special Question (Wh- question). If the student only asks General Questions (Yes/No) for both, deduct points significantly.
          4. If the student corrects themselves, grade the final version.
          ${promptSuffix}
        `;
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: 'audio/webm', data: base64Audio } });
      }

      // --- SECTION 4: PICTURE DESCRIPTION ---
      else if (sectionId === 'sec_4') {
        const imageUrl = question.mediaUrls[0];
        if (imageUrl) {
          const imageBase64 = await urlToBase64(imageUrl);
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
        }

        prompt += `
          Task: Picture Description.
          
          Requirements:
          1. Start with the sentence: "${promptText}" (The student must say this or connect to it).
          2. Describe ALL 4 panels of the comic strip provided in the image. Cover: Time, Place, Main Characters, Event Development.
          3. Tense: Check for accurate use of tenses (usually past tense for narrative).
          4. Grammar & Expression: Meaning must be clear and accurate.
          ${promptSuffix}
        `;
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: 'audio/webm', data: base64Audio } });
      }

      // --- SECTION 5: FAST RESPONSE ---
      else if (sectionId === 'sec_5') {
        const actualQ = cleanHtmlText(gradingContext.actualQuestion || "Unknown Question");
        const refAnswer = cleanHtmlText(question.answerContent);
        
        prompt += `
          Task: Fast Response.
          Question asked to student: "${actualQ}"
          Reference Answer: "${refAnswer}"
          
          Grading Criteria:
          1. Appropriateness: Is the language polite and suitable for the situation?
          2. Emotion/Attitude: Does it convey the right emotion?
          3. Communicative Function: Identify explicitly what communicative function is being tested (e.g., Requesting, Refusing, Greeting) in the feedback.
          ${promptSuffix}
        `;
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: 'audio/webm', data: base64Audio } });
      }

      // --- SECTION 6: SUMMARY & Q&A ---
      else if (sectionId === 'sec_6') {
        const originalText = cleanHtmlText(gradingContext.originalText || "");
        const keywords = gradingContext.keywords ? gradingContext.keywords.join(", ") : "";
        const isQ1 = question.id.endsWith('1');

        prompt += `
          Task: Summary & Q&A.
          Original Article: "${originalText}"
          Question: "${promptText}"
          Keywords (Reference Only): [${keywords}]
          
          Specific Criteria for Question ${isQ1 ? '1' : '2'}:
          ${isQ1 
            ? "This is a DETAIL question. The answer must be faithful to the original text content. It doesn't need to cover everything, but what is said must be accurate based on the text." 
            : "This is an OPEN question. The answer must NOT be less than 3 sentences. It must NOT completely copy the original text. Check for grammar and expression."
          }
          ${promptSuffix}
        `;
        parts.push({ text: prompt });
        parts.push({ inlineData: { mimeType: 'audio/webm', data: base64Audio } });
      }

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              feedback: { type: Type.STRING }
            }
          }
        }
      });

      if (response.text) {
        const result = JSON.parse(response.text);
        setGradingResults(prev => ({
          ...prev,
          [qId]: { score: result.score, feedback: result.feedback, loading: false }
        }));
      } else {
        throw new Error("No response text");
      }

    } catch (error: any) {
      console.error("Grading failed", error);
      const errMsg = error.message?.includes("40") ? "API Key Error or Quota Exceeded" : "评分失败，请稍后重试";
      setGradingResults(prev => ({
        ...prev,
        [qId]: { score: 0, feedback: errMsg, loading: false }
      }));
      if (errMsg.includes("API Key")) setShowApiKeyModal(true);
    }
  };

  const handleBatchGrade = async () => {
     if (!examData) return;
     if (!apiKey) {
       setShowApiKeyModal(true);
       return;
     }

     setIsBatchGrading(true);
     
     // Iterate over all questions
     for (const section of examData) {
       for (const q of section.questions) {
         if (recordings[q.id] && !gradingResults[q.id]) {
           await handleGrade(q, section.id, recordings[q.id]);
           // Small delay to avoid rate limits slightly
           await new Promise(r => setTimeout(r, 1000)); 
         }
       }
     }
     setIsBatchGrading(false);
  };

  const calculateTotalScore = () => {
    let total = 0;
    Object.keys(gradingResults).forEach(qId => {
       const result = gradingResults[qId];
       // Score is now directly the weighted score returned by AI
       total += result.score || 0;
    });
    return total.toFixed(2);
  };

  const handlePrint = () => {
    window.print();
  };

  // --- Preloading Logic ---
  const handleSelectTest = async (testId: string) => {
    setLoadingTest(true);
    setPreloadStatus(null);
    
    // Set Name
    const selectedTest = TEST_SETS.find(t => t.id === testId);
    setCurrentTestName(selectedTest ? selectedTest.name : '');

    try {
      const data = await loadExamData(testId);
      
      const assets = new Set<string>();
      // Add common audio
      assets.add('/assets/template/start.mp3');
      assets.add('/assets/template/stop.mp3');
      assets.add('/assets/template/break.mp3');
      
      data.forEach(section => {
        section.questions.forEach(q => {
          q.mediaUrls.forEach(url => assets.add(url));
          if (q.answerType === 'audio' && q.answerContent) assets.add(q.answerContent);
        });
      });

      const assetsArray = Array.from(assets);
      
      // Filter candidates for preloading (Head request to check size/type)
      const preloadCandidates: {url: string, size: number}[] = [];
      let totalBytes = 0;

      for (const url of assetsArray) {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          const type = res.headers.get('Content-Type') || '';
          const len = Number(res.headers.get('Content-Length') || 0);

          // Rule: Skip videos, Skip > 2MB
          if (!type.startsWith('video/') && len < 2 * 1024 * 1024) {
             preloadCandidates.push({ url, size: len });
             totalBytes += len;
          }
        } catch (e) {
          console.warn("Head check failed", url);
        }
      }

      // Download
      let loadedBytes = 0;
      const totalMB = Math.round(totalBytes / 1024 / 1024 * 100) / 100;
      
      if (preloadCandidates.length > 0) {
        for (const candidate of preloadCandidates) {
            setPreloadStatus({ 
              current: Math.round(loadedBytes / 1024 / 1024 * 100) / 100, 
              total: totalMB,
              file: candidate.url.split('/').pop() || 'file'
            });

            await fetch(candidate.url); // Browser cache warm-up
            loadedBytes += candidate.size;
        }
      }

      setExamData(data);
      setPhase(TestPhase.IDLE);
    } catch (error) {
      console.error(error);
      alert('Failed to load exam data.');
    } finally {
      setLoadingTest(false);
      setPreloadStatus(null);
    }
  };

  // --- Standard Phase Logic (unchanged mostly) ---
  const restartTest = () => {
    setPhase(TestPhase.IDLE);
    setCurrentSectionIndex(0);
    setCurrentQuestionIndex(0);
    setRecordings({});
    setGradingResults({});
    setMediaIndex(0);
  };

  const startTest = () => {
    if (!examData) return;
    setCurrentSectionIndex(0);
    setCurrentQuestionIndex(0);
    setRecordings({});
    setGradingResults({});
    startSection(0);
  };

  const startSection = (sectionIndex: number) => {
    if (!examData) return;
    setCurrentSectionIndex(sectionIndex);
    setCurrentQuestionIndex(0);
    const section = examData[sectionIndex];
    if (section.directionVideoUrl) {
      setPhase(TestPhase.DIRECTION);
    } else {
      startQuestion(sectionIndex, 0);
    }
  };

  const startQuestion = (sectionIdx: number, questionIdx: number) => {
    if (!examData) return;
    setCurrentSectionIndex(sectionIdx);
    setCurrentQuestionIndex(questionIdx);
    setMediaIndex(0); 

    const question = examData[sectionIdx].questions[questionIdx];
    if (question.mediaType === 'video' || (question.mediaType === 'audio' && question.mediaUrls && question.mediaUrls.length > 0)) {
      setPhase(TestPhase.QUESTION_MEDIA);
    } else {
      startPreparation(question);
    }
  };

  const startPreparation = (question: Question) => {
    if (question.prepDuration > 0) {
      setPhase(TestPhase.PREPARATION);
      setTimer(question.prepDuration);
    } else {
      startRecordingPhase(question);
    }
  };

  const startRecordingPhase = (question: Question) => {
    setPhase(TestPhase.STARTING_BEEP);
    const audio = new Audio('/assets/template/start.mp3');
    const beginRecording = () => {
       setPhase(TestPhase.RECORDING);
       setTimer(question.answerDuration);
       startAudioRecorder();
    };
    audio.onended = beginRecording;
    audio.play().catch(() => beginRecording());
  };

  const finishRecordingPhase = useCallback(() => {
    stopAudioRecorder();
    playAudio('/assets/template/stop.mp3');
    setPhase(TestPhase.FINISHING);
    setTimer(2);
  }, []);

  const jumpToQuestion = (sectionIdx: number, questionIdx: number) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    stopAudioRecorder();
    startQuestion(sectionIdx, questionIdx);
  };

  const handleNext = useCallback(() => {
    if (isLastQuestionOfSection) {
      if (isLastSection) {
        setPhase(TestPhase.COMPLETED);
      } else {
        setPhase(TestPhase.SECTION_BREAK);
        setTimer(10);
      }
    } else {
      startQuestion(currentSectionIndex, currentQuestionIndex + 1);
    }
  }, [currentSectionIndex, currentQuestionIndex, isLastQuestionOfSection, isLastSection, examData]);

  const handleSectionBreakEnd = useCallback(() => {
    startSection(currentSectionIndex + 1);
  }, [currentSectionIndex]);

  useEffect(() => {
    if (timer > 0 && (phase === TestPhase.PREPARATION || phase === TestPhase.RECORDING || phase === TestPhase.SECTION_BREAK || phase === TestPhase.FINISHING)) {
      timerIntervalRef.current = window.setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            if (phase === TestPhase.PREPARATION) {
              if (currentQuestion) startRecordingPhase(currentQuestion);
            } else if (phase === TestPhase.RECORDING) {
              finishRecordingPhase();
            } else if (phase === TestPhase.FINISHING) {
              handleNext();
            } else if (phase === TestPhase.SECTION_BREAK) {
              handleSectionBreakEnd();
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timer, phase, currentQuestion, handleNext, handleSectionBreakEnd, finishRecordingPhase]);

  const startAudioRecorder = () => {
    if (!streamRef.current) return;
    audioChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      if (examData) {
        const qId = examData[currentSectionIndex].questions[currentQuestionIndex].id;
        setRecordings(prev => ({ ...prev, [qId]: audioBlob }));
      }
    };
    mediaRecorder.start();
  };

  const stopAudioRecorder = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleMediaEnded = () => {
    if (phase === TestPhase.DIRECTION) {
      startQuestion(currentSectionIndex, 0);
    } else if (phase === TestPhase.QUESTION_MEDIA) {
      if (currentQuestion && currentQuestion.mediaUrls && mediaIndex < currentQuestion.mediaUrls.length - 1) {
        setMediaIndex(prev => prev + 1);
      } else {
        if (currentQuestion) startPreparation(currentQuestion);
      }
    }
  };

  // --- Render Helpers ---

  const renderSidebar = () => {
    if (!examData) return null;
    return (
      <div className="w-1/4 bg-white border-r border-gray-200 h-screen overflow-hidden flex flex-col print:hidden">
        <div className="p-6 border-b border-gray-200 bg-blue-600 text-white shrink-0">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Mic className="w-6 h-6" />
            English Oral Test
          </h1>
          <p className="text-blue-100 text-sm mt-2">Gaokao Simulation Platform</p>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          {examData.map((section, idx) => {
            const isActiveSection = idx === currentSectionIndex && phase !== TestPhase.COMPLETED;
            const isPastSection = idx < currentSectionIndex || phase === TestPhase.COMPLETED;

            return (
              <div key={section.id} className="mb-2">
                <div 
                  onClick={() => startSection(idx)}
                  className={`px-4 py-3 flex items-center justify-between font-semibold text-sm cursor-pointer hover:bg-gray-100 transition-colors ${isActiveSection ? 'bg-blue-50 text-blue-700 border-l-4 border-blue-600' : 'text-gray-600'}`}
                  title="Click to jump to this section"
                >
                  <span>{section.title}</span>
                  {isPastSection && <CheckCircle className="w-4 h-4 text-green-500" />}
                </div>
                
                <div className="px-4 py-2 flex flex-wrap gap-2">
                  {section.questions.map((q, qIdx) => {
                    const isCurrent = isActiveSection && qIdx === currentQuestionIndex;
                    const isDone = (isPastSection) || (isActiveSection && qIdx < currentQuestionIndex);
                    
                    return (
                      <button 
                        key={q.id}
                        onClick={() => jumpToQuestion(idx, qIdx)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs border transition-all cursor-pointer hover:shadow-md
                          ${isCurrent ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-110' : 
                            isDone ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200' : 
                            'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'}`}
                        disabled={phase === TestPhase.COMPLETED}
                      >
                        {qIdx + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {phase !== TestPhase.COMPLETED && (
          <div className="p-4 border-t border-gray-200 bg-gray-50 shrink-0">
            <button 
              onClick={() => {
                if(confirm("Are you sure you want to finish the exam early?")) {
                  stopAudioRecorder();
                  setPhase(TestPhase.COMPLETED);
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg font-semibold transition-all shadow-sm text-sm"
            >
              <Flag className="w-4 h-4" /> Finish Exam
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderResults = () => {
    if (!examData) return null;
    const totalScore = calculateTotalScore();

    return (
      <div className="flex-1 p-10 bg-gray-50 overflow-y-auto h-screen print:p-0 print:overflow-visible">
        {/* API Key & Settings Modal */}
        {showApiKeyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm print:hidden">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
               <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                 <Settings2 className="w-5 h-5 text-blue-600" />
                 AI Configuration
               </h3>
               
               {/* API Key Input */}
               <div className="mb-4">
                 <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
                 <input 
                   type="password" 
                   value={apiKey} 
                   onChange={handleApiKeyChange}
                   placeholder="AIza..."
                   className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                 />
                 <a 
                   href="https://aistudio.google.com/app/apikey" 
                   target="_blank" 
                   rel="noreferrer"
                   className="text-xs text-blue-600 hover:underline mt-1 block"
                 >
                   Get an API key from Google AI Studio
                 </a>
               </div>

               {/* Model Selection */}
               <div className="mb-6">
                 <label className="block text-sm font-medium text-gray-700 mb-1">
                   Gemini Model 
                   {loadingModels && <span className="text-xs text-gray-400 font-normal ml-2">(Fetching models...)</span>}
                 </label>
                 <select 
                   value={selectedModel}
                   onChange={(e) => setSelectedModel(e.target.value)}
                   className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                 >
                   {modelList.map(model => (
                     <option key={model} value={model}>{model}</option>
                   ))}
                 </select>
                 <p className="text-xs text-gray-500 mt-1">
                   Enter a valid API key to load available models.
                 </p>
               </div>

               {apiError && <p className="text-red-500 text-sm mb-4">{apiError}</p>}
               
               <div className="flex justify-end gap-3">
                 <button onClick={() => setShowApiKeyModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                 <button onClick={saveSettings} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Settings</button>
               </div>
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-8 print:shadow-none print:max-w-none">
          <div className="text-center mb-8 border-b pb-6 print:border-none">
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">{currentTestName}</h1>
            <h2 className="text-3xl font-bold text-gray-800">Test Report</h2>
            
            {/* Score Card */}
            <div className="mt-6 inline-block bg-slate-50 border border-slate-200 rounded-xl px-8 py-4">
               <span className="text-slate-500 text-sm uppercase font-bold tracking-wide">Total Score</span>
               <div className="text-4xl font-black text-blue-600 mt-1">{totalScore} <span className="text-lg text-slate-400 font-medium">/ 10</span></div>
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex justify-center gap-3 print:hidden">
              <button 
                onClick={handleBatchGrade}
                disabled={isBatchGrading}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50"
              >
                {isBatchGrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isBatchGrading ? 'Grading...' : 'Grade All Answers'}
              </button>
              <button 
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg font-medium transition-colors shadow-sm"
              >
                <Printer className="w-4 h-4" /> Print PDF
              </button>
              <button 
                onClick={() => setShowApiKeyModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors shadow-sm"
                title="AI Settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {examData.map(section => (
              <div key={section.id} className="border rounded-lg overflow-hidden bg-white shadow-sm print:border-gray-200 print:shadow-none print:mb-4">
                <div className="bg-gray-100 px-4 py-3 font-medium text-gray-700 border-b flex items-center gap-2 print:bg-gray-50">
                   <BookOpen className="w-4 h-4 text-gray-500"/> 
                   {section.title}
                </div>
                
                {/* SECTION 6: ORIGINAL ARTICLE DISPLAY */}
                {section.id === 'sec_6' && section.questions.length > 0 && section.questions[0].gradingContext?.originalText && (
                  <div className="p-6 bg-slate-50 border-b border-gray-100">
                    <div className="flex items-center gap-2 mb-2 text-slate-700 font-bold">
                       <FileText className="w-4 h-4" /> Original Article
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed font-serif whitespace-pre-wrap">
                      {cleanHtmlText(section.questions[0].gradingContext.originalText)}
                    </p>
                  </div>
                )}

                <div className="divide-y divide-gray-100">
                  {section.questions.map(q => {
                    const blob = recordings[q.id];
                    const grade = gradingResults[q.id];
                    const maxScore = SECTION_POINTS[q.id] || 0;
                    
                    // Specific Displays for certain sections
                    const showImage = section.id === 'sec_4' && q.mediaUrls.length > 0;
                    const showPromptText = section.id === 'sec_5';

                    return (
                      <div key={q.id} className="p-6 break-inside-avoid">
                         <div className="flex items-start justify-between mb-4">
                            <div className="flex-1">
                                <span className="inline-block px-2 py-1 rounded text-xs font-bold bg-blue-100 text-blue-700 mb-2 print:border print:border-blue-200">
                                  {q.label}
                                </span>
                                
                                {/* SECTION 4: IMAGE */}
                                {showImage && (
                                  <div className="mb-4 max-w-sm">
                                    <div className="flex items-center gap-1 text-xs font-bold text-gray-400 uppercase mb-1">
                                      <ImageIcon className="w-3 h-3" /> Question Image
                                    </div>
                                    <img src={q.mediaUrls[0]} alt="Question" className="rounded-lg border border-gray-200 shadow-sm" />
                                  </div>
                                )}

                                <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                                  {showPromptText && q.gradingContext?.actualQuestion ? (
                                    <span className="font-medium text-slate-800 block mb-1">
                                      Question: {cleanHtmlText(q.gradingContext.actualQuestion)}
                                    </span>
                                  ) : null}
                                  {cleanHtmlText(q.promptText)}
                                </p>
                            </div>
                            <div className="ml-4 flex items-center gap-2 flex-col print:hidden">
                                {blob ? (
                                    <>
                                      <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                                        <audio controls src={URL.createObjectURL(blob)} className="h-8 w-40" />
                                      </div>
                                      
                                      <button 
                                        onClick={() => handleGrade(q, section.id, blob)}
                                        disabled={grade?.loading}
                                        className={`mt-2 w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-semibold transition-colors
                                          ${grade 
                                            ? 'bg-purple-50 text-purple-700 border border-purple-100' 
                                            : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm hover:from-indigo-600 hover:to-purple-700'
                                          }
                                          disabled:opacity-70 disabled:cursor-not-allowed`}
                                      >
                                        {grade?.loading ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Sparkles className="w-3 h-3" />
                                        )}
                                        {grade ? 'Re-Evaluate' : 'AI Grade'}
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-red-400 text-xs font-medium bg-red-50 px-2 py-1 rounded">No recording</span>
                                  )}
                            </div>
                         </div>

                         {/* AI Result Section */}
                         {grade && !grade.loading && (
                           <div className="mb-4 bg-purple-50 border border-purple-100 rounded-lg p-4 print:bg-white print:border-purple-200">
                              <div className="flex items-start gap-3">
                                <div className="p-2 bg-white rounded-full shadow-sm print:hidden">
                                  <BrainCircuit className="w-5 h-5 text-purple-600" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-baseline justify-between mb-1">
                                    <h4 className="font-bold text-purple-900">AI Evaluation</h4>
                                    <span className="text-xl font-black text-purple-600">{grade.score}<span className="text-xs text-purple-400 font-medium ml-1">/{maxScore}</span></span>
                                  </div>
                                  <p className="text-sm text-purple-800 leading-relaxed bg-white/50 p-3 rounded-md border border-purple-100/50 print:border-0 print:p-0">
                                    {grade.feedback}
                                  </p>
                                </div>
                              </div>
                           </div>
                         )}

                         <div className="mt-4 pt-4 border-t border-dashed border-gray-200 print:hidden">
                            <h4 className="text-xs font-bold text-green-600 uppercase mb-2 flex items-center gap-1">
                               <CheckCircle className="w-3 h-3" /> Reference Answer
                            </h4>
                            <div className="bg-green-50/50 p-3 rounded-md border border-green-100 text-sm text-gray-700 leading-relaxed">
                               {q.answerType === 'audio' ? (
                                 <audio controls src={q.answerContent} className="w-full h-8" />
                               ) : (
                                 <p className="whitespace-pre-wrap font-serif">
                                  {cleanHtmlText(q.gradingContext?.refAnswers ? q.gradingContext.refAnswers.join('\nOR\n') : q.answerContent)}
                                 </p>
                               )}
                            </div>
                         </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-center gap-4 print:hidden">
            <button onClick={restartTest} className="flex items-center gap-2 px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors">
              <RefreshCw className="w-5 h-5" /> Restart Test
            </button>
            <button onClick={() => alert("Please download individual files above.")} className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-md">
              <Download className="w-5 h-5" /> Download All
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTestArea = () => {
    if (!currentSection) return null;

    if (phase === TestPhase.SECTION_BREAK) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-800 text-white h-screen">
          <audio src="/assets/template/break.mp3" autoPlay />
          <div className="text-center space-y-6 animate-pulse">
            <h2 className="text-4xl font-bold text-yellow-400">Section Break</h2>
            <div className="text-8xl font-mono font-bold">{timer}</div>
            <p className="text-xl text-slate-300">Next section starting soon...</p>
            <p className="text-xl text-slate-300">*如未能自动跳转，请手动点击左侧下一题题号跳转</p>
          </div>
        </div>
      );
    }

    if (phase === TestPhase.DIRECTION && currentSection.directionVideoUrl) {
      return (
        <div className="flex-1 flex flex-col h-screen bg-black">
          <div className="flex-1 flex items-center justify-center">
            <video 
              src={currentSection.directionVideoUrl}
              autoPlay 
              controls={false}
              onEnded={handleMediaEnded}
              className="max-w-full max-h-full aspect-video"
            />
          </div>
          <div className="h-16 bg-slate-900 text-white flex items-center justify-center text-lg font-medium">
            Playing Directions for: {currentSection.title}
          </div>
        </div>
      );
    }

    if (!currentQuestion) return null;

    const showMedia = phase === TestPhase.QUESTION_MEDIA;
    const showPrep = phase === TestPhase.PREPARATION;
    const isStarting = phase === TestPhase.STARTING_BEEP;
    const showRecord = phase === TestPhase.RECORDING;
    const isFinishing = phase === TestPhase.FINISHING;

    const currentMediaUrl = currentQuestion.mediaUrls && currentQuestion.mediaUrls[mediaIndex];
    const hasVisualMedia = currentQuestion.mediaType === 'image' || currentQuestion.mediaType === 'video';
    const hasAudioMedia = currentQuestion.mediaType === 'audio';
    const showTextPrompt = !hasVisualMedia;

    return (
      <div className="flex-1 flex flex-col h-screen relative bg-gray-50">
        <div className="h-16 bg-white border-b border-gray-200 flex items-center px-8 justify-between shadow-sm z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-800">{currentSection.title}</h2>
            <span className="text-sm text-gray-500">{currentQuestion.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              phase === TestPhase.PREPARATION ? 'bg-yellow-100 text-yellow-700' :
              phase === TestPhase.RECORDING ? 'bg-red-100 text-red-600 animate-pulse' :
              phase === TestPhase.FINISHING ? 'bg-gray-100 text-gray-700' :
              phase === TestPhase.STARTING_BEEP ? 'bg-orange-100 text-orange-600' :
              'bg-blue-100 text-blue-700'
            }`}>
              {phase === TestPhase.QUESTION_MEDIA ? 'Playing Question' : 
               phase === TestPhase.PREPARATION ? 'Preparation' : 
               phase === TestPhase.STARTING_BEEP ? 'Get Ready' :
               phase === TestPhase.FINISHING ? 'Saving...' : 'Recording'}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center justify-center">
          <div className="w-full max-w-5xl bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden min-h-[400px] flex flex-col">
            {hasVisualMedia && (
              <div className="flex-1 bg-black/5 flex items-center justify-center relative min-h-[400px] p-4">
                {currentQuestion.mediaType === 'image' && currentMediaUrl && (
                  <img 
                    src={currentMediaUrl} 
                    alt="Question Prompt" 
                    className="w-full h-full max-h-[80vh] object-contain" 
                  />
                )}
                {(currentQuestion.mediaType === 'video') && currentMediaUrl && (
                  <video 
                    key={`vid-${currentQuestion.id}-${mediaIndex}`} 
                    src={currentMediaUrl}
                    autoPlay={showMedia}
                    controls={false}
                    onEnded={handleMediaEnded}
                    muted={!showMedia}
                    className="w-full h-full max-h-[80vh] object-contain"
                  />
                )}
              </div>
            )}

            {hasAudioMedia && (
               <div className="bg-blue-50 py-4 flex items-center justify-center border-b border-blue-100">
                 {showMedia && currentMediaUrl && (
                   <audio 
                     key={`audio-${currentQuestion.id}-${mediaIndex}`}
                     src={currentMediaUrl} 
                     autoPlay 
                     onEnded={handleMediaEnded}
                     className="hidden" 
                   />
                 )}
                 <div className="flex items-center gap-3 text-blue-700">
                    <div className={`p-2 rounded-full bg-blue-200 ${showMedia ? 'animate-pulse' : ''}`}>
                      <FileAudio className="w-6 h-6" />
                    </div>
                    <span className="font-medium text-sm">
                      {showMedia ? `Playing Audio Part ${mediaIndex + 1}...` : "Audio Prompt Finished"}
                    </span>
                 </div>
               </div>
            )}

            {showTextPrompt && (
              <div className="p-8 bg-white text-left flex-1 flex flex-col justify-center min-h-[400px]">
                <p className="text-gray-800 font-medium leading-loose text-lg whitespace-pre-wrap">
                  {currentQuestion.promptText}
                </p>
              </div>
            )}
          </div>
        </div>

        {!showMedia && (
          <div className="h-32 bg-white border-t border-gray-200 flex items-center justify-center relative shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
            <div className="flex flex-col items-center w-full max-w-2xl px-4">
              <div className="w-full h-16 flex items-center justify-center mb-2 gap-4">
                 {(showRecord || isFinishing) ? (
                   <div className="flex items-center w-full gap-4">
                     <div className={`font-bold whitespace-nowrap flex items-center gap-2 ${isFinishing ? 'text-gray-500' : 'text-red-500 animate-pulse'}`}>
                       <div className={`w-3 h-3 rounded-full ${isFinishing ? 'bg-gray-500' : 'bg-red-500'}`}></div>
                       {isFinishing ? 'Finished' : 'Recording'}
                     </div>
                     <div className="flex-1 flex justify-center">
                       {!isFinishing && <Waveform stream={streamRef.current} isRecording={showRecord} />}
                     </div>
                     {/* Stop Button */}
                     {!isFinishing && (
                       <button 
                         onClick={finishRecordingPhase}
                         className="flex items-center justify-center w-10 h-10 bg-red-100 hover:bg-red-200 text-red-600 rounded-full transition-colors"
                         title="Stop Recording"
                       >
                         <Square className="w-5 h-5 fill-current" />
                       </button>
                     )}
                   </div>
                 ) : (
                   <div className="flex flex-col items-center w-full">
                     {showPrep ? (
                        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                           <span className="text-gray-400 font-medium">Prepare your answer...</span>
                           <button 
                             onClick={() => currentQuestion && startRecordingPhase(currentQuestion)}
                             className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 rounded-full text-xs font-bold uppercase tracking-wide transition-all border border-blue-200 shadow-sm"
                           >
                             <SkipForward className="w-3 h-3" />
                             Start Now
                           </button>
                        </div>
                     ) : (
                        <div className="text-gray-400 font-medium flex items-center gap-2">
                          {isStarting ? 'Wait for signal...' : ''}
                        </div>
                     )}
                   </div>
                 )}
              </div>

              {!isFinishing && !isStarting && (
                <div className="w-full flex items-center gap-4">
                  <Clock className={`w-5 h-5 ${showRecord ? 'text-red-500' : 'text-blue-500'}`} />
                  <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${showRecord ? 'bg-red-500' : 'bg-blue-500'}`}
                      style={{ 
                        width: `${(timer / (showRecord ? currentQuestion.answerDuration : (currentQuestion.prepDuration || 1))) * 100}%` 
                      }}
                    />
                  </div>
                  <span className={`text-xl font-mono font-bold w-16 text-right ${showRecord ? 'text-red-600' : 'text-blue-600'}`}>
                    {timer}s
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!hasPermission) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto text-blue-600">
            <Mic size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">System Check</h1>
            <p className="text-gray-500 mt-2">
              To begin the English Speaking Test, we need access to your microphone.
            </p>
          </div>
          <button 
            onClick={requestPermissions}
            className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            Start System Check
          </button>
        </div>
      </div>
    );
  }

  if (!examData && phase === TestPhase.IDLE) {
     return (
       <div className="min-h-screen bg-slate-50 flex flex-col">
         <div className="bg-white border-b px-8 py-4 flex justify-between items-center">
           <div className="flex items-center gap-2 font-bold text-xl text-slate-800">
             <Mic className="text-blue-600" />
             <span>Gaokao Simulator</span>
           </div>
           {!apiKey && (
             <button onClick={() => setShowApiKeyModal(true)} className="text-sm text-blue-600 font-medium hover:underline">
               Set API Key
             </button>
           )}
         </div>

         <div className="flex-1 flex flex-col items-center justify-center p-8">
           <div className="max-w-3xl w-full text-center space-y-8">
              <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Select an Exam Paper</h1>
              <p className="text-lg text-slate-600">
                Choose a simulation set to begin.
              </p>
              
              {loadingTest ? (
                <div className="flex flex-col items-center justify-center py-12 w-full max-w-md mx-auto">
                   <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                   <p className="text-slate-500 mb-4 font-medium">
                     {preloadStatus ? 'Preloading media assets...' : 'Fetching exam config...'}
                   </p>
                   {preloadStatus && (
                     <div className="w-full">
                       <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                         <div 
                           className="h-full bg-blue-600 transition-all duration-300 ease-out"
                           style={{ width: `${(preloadStatus.current / preloadStatus.total) * 100}%` }}
                         />
                       </div>
                       <div className="flex justify-between text-xs text-slate-400 mt-2 font-mono">
                         <span>{preloadStatus.file}</span>
                         <span>{preloadStatus.current} / {preloadStatus.total} MB</span>
                       </div>
                     </div>
                   )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {TEST_SETS.map((test) => (
                    <button 
                      key={test.id}
                      onClick={() => handleSelectTest(test.id)}
                      className="flex flex-col items-center p-6 bg-white rounded-xl shadow-sm border-2 border-slate-100 hover:border-blue-500 hover:shadow-md transition-all group"
                    >
                      <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        <FolderOpen className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-800">{test.name}</h3>
                      <p className="text-slate-500 text-sm mt-2">Click to load</p>
                    </button>
                  ))}
                </div>
              )}
           </div>
         </div>
         {/* Re-use API Key modal here for initial entry */}
         {showApiKeyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
               <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                 <Settings2 className="w-5 h-5 text-blue-600" />
                 AI Configuration
               </h3>
               
               {/* API Key Input */}
               <div className="mb-4">
                 <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key</label>
                 <input 
                   type="password" 
                   value={apiKey} 
                   onChange={handleApiKeyChange}
                   placeholder="AIza..."
                   className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                 />
                 <a 
                   href="https://aistudio.google.com/app/apikey" 
                   target="_blank" 
                   rel="noreferrer"
                   className="text-xs text-blue-600 hover:underline mt-1 block"
                 >
                   Get an API key from Google AI Studio
                 </a>
               </div>

               {/* Model Selection */}
               <div className="mb-6">
                 <label className="block text-sm font-medium text-gray-700 mb-1">
                   Gemini Model 
                   {loadingModels && <span className="text-xs text-gray-400 font-normal ml-2">(Fetching models...)</span>}
                 </label>
                 <select 
                   value={selectedModel}
                   onChange={(e) => setSelectedModel(e.target.value)}
                   className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                 >
                   {modelList.map(model => (
                     <option key={model} value={model}>{model}</option>
                   ))}
                 </select>
                 <p className="text-xs text-gray-500 mt-1">
                   Enter a valid API key to load available models.
                 </p>
               </div>

               {apiError && <p className="text-red-500 text-sm mb-4">{apiError}</p>}
               
               <div className="flex justify-end gap-3">
                 <button onClick={() => setShowApiKeyModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                 <button onClick={saveSettings} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Settings</button>
               </div>
            </div>
          </div>
         )}
       </div>
     )
  }

  if (examData && phase === TestPhase.IDLE) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
         <div className="bg-white border-b px-8 py-4 flex justify-between items-center">
           <div className="flex items-center gap-2 font-bold text-xl text-slate-800">
             <Mic className="text-blue-600" />
             <span>Gaokao Simulator</span>
           </div>
         </div>

         <div className="flex-1 flex flex-col items-center justify-center p-8">
           <div className="max-w-2xl w-full text-center space-y-8">
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-green-100 text-green-700 font-medium text-sm">
                <CheckCircle className="w-4 h-4 mr-2" />
                Exam Data Loaded
              </div>
              <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">High School English Speaking Test</h1>
              <p className="text-lg text-slate-600">
                This simulation consists of {examData.length} parts. It includes reading, listening, and speaking tasks. 
              </p>
              
              <div className="grid grid-cols-2 gap-4 text-left">
                {examData.map((s, i) => (
                  <div key={s.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">Part {i + 1}</span>
                    <h3 className="font-semibold text-slate-800">{s.title}</h3>
                  </div>
                ))}
              </div>

              <div className="pt-8 flex justify-center gap-4">
                <button 
                  onClick={() => setExamData(null)}
                  className="px-6 py-4 text-slate-500 font-medium hover:text-slate-700 transition-colors"
                >
                  Back
                </button>
                <button 
                  onClick={startTest}
                  className="group relative inline-flex items-center justify-center px-8 py-4 text-lg font-bold text-white transition-all duration-200 bg-blue-600 font-pj rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 hover:bg-blue-700"
                >
                  Start Exam
                  <Play className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
           </div>
         </div>
      </div>
    );
  }

  if (phase === TestPhase.COMPLETED) {
    return (
      <div className="flex h-screen w-full bg-white flex-col md:flex-row print:block">
        {renderSidebar()}
        {renderResults()}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-white overflow-hidden">
      {renderSidebar()}
      {renderTestArea()}
    </div>
  );
};

export default App;