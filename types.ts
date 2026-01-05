export type MediaType = 'none' | 'audio' | 'video' | 'image';
export type AnswerType = 'text' | 'audio';

export interface GradingContext {
  originalText?: string; // For Section 6 (Article)
  keywords?: string[]; // For Section 6
  actualQuestion?: string; // For Section 5 (Hidden prompt)
  refAnswers?: string[]; // For Section 3 (All valid answers)
}

export interface Question {
  id: string;
  label: string; // e.g., "Question 1"
  promptText: string;
  mediaUrls: string[]; // Changed from optional single string to array
  mediaType: MediaType;
  prepDuration: number; // seconds. 0 means no prep.
  answerDuration: number; // seconds
  
  // New fields for Answer View
  answerType: AnswerType;
  answerContent: string; // URL for audio, text content for text
  
  // Context for AI
  gradingContext?: GradingContext;
}

export interface Section {
  id: string;
  title: string;
  description: string;
  directionVideoUrl?: string; // Video played before the section starts
  questions: Question[];
}

export enum TestPhase {
  IDLE = 'IDLE',
  LOADING = 'LOADING', // Loading exam data
  DIRECTION = 'DIRECTION', // Playing section instruction video
  QUESTION_MEDIA = 'QUESTION_MEDIA', // Playing question specific media (e.g. video question)
  PREPARATION = 'PREPARATION', // Countdown before recording
  STARTING_BEEP = 'STARTING_BEEP', // Playing start beep before recording begins
  RECORDING = 'RECORDING', // Recording answer
  FINISHING = 'FINISHING', // Short delay after recording before next question
  SECTION_BREAK = 'SECTION_BREAK', // 10s break between sections
  COMPLETED = 'COMPLETED' // Test finished
}

export interface RecordingMap {
  [questionId: string]: Blob;
}