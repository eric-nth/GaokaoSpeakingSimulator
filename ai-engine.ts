import { GoogleGenAI, Modality, Type } from "@google/genai";
import { Question, Section, MediaType } from "./types";

// --- WAV Header Helpers ---
function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function createWavBlob(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write audio data
  const dataView = new Uint8Array(buffer, 44);
  dataView.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

// Helper to convert base64 audio to Blob URL with WAV header
const base64ToAudioUrl = (base64: string): string => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  // Gemini TTS returns raw PCM (24kHz, 1ch, 16-bit)
  const wavBlob = createWavBlob(byteArray, 24000);
  return URL.createObjectURL(wavBlob);
};

interface AIConfig {
  apiKey: string;
  textModel: string;
  audioModel: string;
  imageModel: string;
}

export class AIEngine {
  private config: AIConfig;
  private ai: GoogleGenAI;

  constructor(config: AIConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
  }

  // --- TTS Generation ---
  async generateSpeech(text: string, voiceName: string = 'Kore'): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.config.audioModel,
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data returned");
      
      return base64ToAudioUrl(base64Audio);
    } catch (e) {
      console.error("TTS Generation Error:", e);
      return ""; // Fail gracefully or handle upstream
    }
  }

  // --- Image Generation ---
  async generateImage(prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.config.imageModel,
        contents: {
          parts: [{ text: prompt }],
        },
        config: {
           // For nano banana series, no responseMimeType
        },
      });

      // Find image part
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      throw new Error("No image generated");
    } catch (e) {
      console.error("Image Gen Error:", e);
      return "";
    }
  }

  // --- Section Generation Logic ---

  async generateSectionContent(sectionId: string, confirmImageGen: () => Promise<boolean>): Promise<Partial<Section> | null> {
    // 1. Generate Prompt based on Section ID
    if (sectionId === 'sec_1') return this.generateSection1();
    if (sectionId === 'sec_2') return this.generateSection2();
    if (sectionId === 'sec_3') return this.generateSection3();
    if (sectionId === 'sec_4') return this.generateSection4(confirmImageGen);
    if (sectionId === 'sec_5') return this.generateSection5();
    if (sectionId === 'sec_6') return this.generateSection6();
    return null;
  }

  // Common instruction for vocabulary level
  private vocabInstruction = "Use simple English vocabulary suitable for Chinese High School Gaokao students (within 3000 words). Content should be related to daily life or campus life.";

  // Section 1: Read Aloud Sentences
  private async generateSection1(): Promise<Partial<Section>> {
    const prompt = `Generate 2 English sentences for a "Read Aloud" test.
    ${this.vocabInstruction}
    1. First sentence: 15-20 words.
    2. Second sentence: 25-35 words. Include some words with tricky stress or pronunciation.
    Return JSON: { "s1": "...", "s2": "..." }`;

    const resp = await this.ai.models.generateContent({
      model: this.config.textModel,
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    const json = JSON.parse(resp.text || "{}");

    return {
      questions: [
        { id: 'q1_1', label: '第一题', promptText: json.s1, mediaType: 'none', prepDuration: 30, answerDuration: 15, mediaUrls: [], answerType: 'audio', answerContent: '' },
        { id: 'q1_2', label: '第二题', promptText: json.s2, mediaType: 'none', prepDuration: 30, answerDuration: 15, mediaUrls: [], answerType: 'audio', answerContent: '' },
      ]
    } as any;
  }

  // Section 2: Read Paragraph
  private async generateSection2(): Promise<Partial<Section>> {
    const prompt = `Generate a coherent English paragraph of exactly 100 words (+/- 10) for a reading test. 
    ${this.vocabInstruction}
    Return just the text.`;
    
    const resp = await this.ai.models.generateContent({
      model: this.config.textModel,
      contents: prompt
    });

    return {
      questions: [{ id: 'q2_1', label: '段落朗读', promptText: resp.text || "", mediaType: 'none', prepDuration: 60, answerDuration: 30, mediaUrls: [], answerType: 'audio', answerContent: '' }]
    } as any;
  }

  // Section 3: Situation Q&A
  private async generateSection3(): Promise<Partial<Section>> {
    const prompt = `Generate 2 situations for an English oral test where the student asks questions.
    ${this.vocabInstruction}
    Format JSON: 
    [
      { "situation": "Situation description...", "refAnswer": "Valid question 1..." },
      { "situation": "Situation description...", "refAnswer": "Valid question 1..." }
    ]
    Rules:
    - End instruction with "Ask ... two questions about ...".
    - Length: 15-30 words each.
    `;

    const resp = await this.ai.models.generateContent({
      model: this.config.textModel,
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    const data = JSON.parse(resp.text || "[]");

    // Parallel TTS
    const [audio1, audio2] = await Promise.all([
      this.generateSpeech(data[0].situation, 'Puck'),
      this.generateSpeech(data[1].situation, 'Fenrir')
    ]);

    return {
      questions: [
        { 
          id: 'q3_1', label: '第一题', promptText: data[0].situation, 
          mediaType: 'audio', prepDuration: 0, answerDuration: 20, 
          mediaUrls: [audio1], answerType: 'text', answerContent: data[0].refAnswer,
          gradingContext: { refAnswers: [data[0].refAnswer] }
        },
        { 
          id: 'q3_2', label: '第二题', promptText: data[1].situation, 
          mediaType: 'audio', prepDuration: 0, answerDuration: 20, 
          mediaUrls: [audio2], answerType: 'text', answerContent: data[1].refAnswer,
          gradingContext: { refAnswers: [data[1].refAnswer] }
        },
      ]
    } as any;
  }

  // Section 4: Picture Description
  private async generateSection4(confirmGen: () => Promise<boolean>): Promise<Partial<Section>> {
    // 1. Generate Story
    const storyPrompt = `Generate a short story (120-130 words) with 7-8 sentences. 
    ${this.vocabInstruction}
    Return JSON: { "story": "full text...", "firstSentence": "The background sentence (max 10 words)...", "panels": ["desc1", "desc2", "desc3", "desc4"] }
    The 'panels' are visual descriptions for a 4-panel comic strip summarizing the story.`;

    const resp = await this.ai.models.generateContent({
      model: this.config.textModel,
      contents: storyPrompt,
      config: { responseMimeType: "application/json" }
    });
    const data = JSON.parse(resp.text || "{}");

    let imageUrl = '';
    // 2. Ask user confirmation for image generation
    const shouldGen = await confirmGen();
    
    if (shouldGen) {
      const imgPrompt = `A simple black and white line art 4-panel comic strip. 
      Panel 1: ${data.panels[0]}. 
      Panel 2: ${data.panels[1]}. 
      Panel 3: ${data.panels[2]}. 
      Panel 4: ${data.panels[3]}.
      Style: Minimalist, clear, educational illustration.`;
      imageUrl = await this.generateImage(imgPrompt);
    } else {
      // Use a placeholder or skip
      imageUrl = "https://placehold.co/600x400?text=Image+Skipped";
    }

    return {
      questions: [{ 
        id: 'q4_1', label: '图片描述', 
        promptText: 'Describe the picture based on the story.', 
        mediaType: 'image', prepDuration: 60, answerDuration: 60, 
        mediaUrls: [imageUrl], answerType: 'text', answerContent: data.story,
        gradingContext: { startSentence: data.firstSentence }
      }]
    } as any;
  }

  // Section 5: Fast Response
  private async generateSection5(): Promise<Partial<Section>> {
    const prompt = `Generate 4 "Fast Response" items.
    ${this.vocabInstruction}
    Each item has a prompt sentence (8-16 words) and a communicative function/emotion.
    Return JSON: [ { "prompt": "...", "intent": "...", "refAnswer": "..." }, ... (4 items) ]
    Emotions to cover: Joy, Regret, Request, Prohibition.`;

    const resp = await this.ai.models.generateContent({
      model: this.config.textModel,
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    const data = JSON.parse(resp.text || "[]");

    // Generate Audio with varied voices
    const audios = await Promise.all(data.map((item: any, idx: number) => 
      this.generateSpeech(item.prompt, idx % 2 === 0 ? 'Kore' : 'Puck')
    ));

    return {
      questions: data.map((item: any, idx: number) => ({
        id: `q5_${idx+1}`, label: `第${idx+1}题`,
        promptText: 'Listen and answer.',
        mediaType: 'audio', // Changed from video to audio as per requirement (no video gen)
        prepDuration: 0, answerDuration: 5,
        mediaUrls: [audios[idx]],
        answerType: 'text', answerContent: item.refAnswer,
        gradingContext: { actualQuestion: item.prompt }
      }))
    } as any;
  }

  // Section 6: Summary & Q&A
  private async generateSection6(): Promise<Partial<Section>> {
    const prompt = `Generate a short expository essay (200-220 words).
    ${this.vocabInstruction}
    Structure: Clear introduction, parallel points (firstly, secondly...), conclusion.
    Generate 2 questions:
    1. Detail question (answer found in text).
    2. Open question (related to topic).
    Return JSON: { "article": "...", "q1": "...", "q1_ans": "...", "q2": "...", "q2_ans": "...", "keywords": "kw1 | kw2 | kw3" }`;

    const resp = await this.ai.models.generateContent({
      model: this.config.textModel,
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    const data = JSON.parse(resp.text || "{}");

    // Audio for Article and Questions
    const articleAudio = await this.generateSpeech(data.article, 'Fenrir');
    const q1Audio = await this.generateSpeech(data.q1, 'Kore');
    const q2Audio = await this.generateSpeech(data.q2, 'Kore');

    return {
      questions: [
        {
          id: 'q6_1', label: '简述', promptText: data.q1,
          mediaType: 'audio', prepDuration: 30, answerDuration: 30,
          mediaUrls: [articleAudio, q1Audio], // Plays article, then Q1
          answerType: 'text', answerContent: data.q1_ans,
          gradingContext: { originalText: data.article, keywords: data.keywords.split('|') }
        },
        {
          id: 'q6_2', label: '问答', promptText: data.q2,
          mediaType: 'audio', prepDuration: 60, answerDuration: 60,
          mediaUrls: [q2Audio], // Only plays Q2
          answerType: 'text', answerContent: data.q2_ans,
          gradingContext: { originalText: data.article, keywords: [] }
        }
      ]
    } as any;
  }
}