import { Section } from './types';

export const TEST_SETS = [
  { id: 'test_1', name: '上海新高考模拟试题1' },
  { id: 'test_2', name: '上海新高考模拟试题2' },
  { id: 'test_3', name: '上海新高考模拟试题3' },
  { id: 'test_4', name: '上海新高考模拟试题4' },
  { id: 'test_5', name: '上海新高考模拟试题5' },
  { id: 'test_6', name: '上海新高考模拟试题6' },
  { id: 'test_7', name: '上海新高考模拟试题7' },
  { id: 'test_8', name: '上海新高考模拟试题8' },
  { id: 'test_9', name: '上海新高考模拟试题9' },
  { id: 'test_10', name: '上海新高考模拟试题10' }
];

export const loadExamData = async (testFolder: string): Promise<Section[]> => {
  // Assuming testFolder is like "test_1"
  // The path will be /test_1/
  const root = `/${testFolder}`;
  
  // Helper to safely fetch text
  const getText = async (path: string, extractor: (json: any) => string): Promise<string> => {
    try {
      const res = await fetch(path);
      if (!res.ok) {
        console.warn(`File not found or failed to load: ${path}`);
        return `[Error loading content from ${path}]`;
      }
      const json = await res.json();
      return extractor(json);
    } catch (e) {
      console.error(`Error parsing ${path}`, e);
      return `[Error parsing content from ${path}]`;
    }
  };

  // Helper to parse STD array to string (for answers)
  const getStdText = async (path: string, extractor: (json: any) => any[]): Promise<string> => {
    try {
      const res = await fetch(path);
      if (!res.ok) return '';
      const json = await res.json();
      const arr = extractor(json);
      if (Array.isArray(arr)) {
        return arr.map((item: any) => item.value).join('\n');
      }
      return '';
    } catch (e) {
      console.error(`Error parsing std from ${path}`, e);
      return '';
    }
  };

  // --- Section 1: 朗读句子 ---
  const s1q1Text = await getText(`${root}/1/content2.json`, j => j.info.value);
  const s1q2Text = await getText(`${root}/2/content2.json`, j => j.info.value);
  
  // --- Section 2: 朗读段落 ---
  const s2TextRaw = await getText(`${root}/3/content2.json`, j => j.info.value);
  const s2Text = s2TextRaw.replace(/<p>|<\/p>|<br\/>/g, '');

  // --- Section 3: 情景提问 ---
  let s3q1Text = '', s3q2Text = '';
  let s3q1Ans = '', s3q2Ans = '';
  let s3q1RefAnswers: string[] = [];
  try {
    const res = await fetch(`${root}/4/content2.json`);
    if (res.ok) {
      const json = await res.json();
      s3q1Text = json.info.question?.[0]?.ask || 'Question 1';
      s3q2Text = json.info.question?.[1]?.ask || 'Question 2';
      
      // Answers
      const q1Std = json.info.question?.[0]?.std || [];
      s3q1Ans = q1Std.map((i: any) => i.value).join('\n');
      s3q1RefAnswers = q1Std.map((i: any) => i.value); // Store array for grading
      
      // Per instruction: Section 3 Q2 reads info.question[1].std
      const q2Std = json.info.question?.[1]?.std || [];
      s3q2Ans = q2Std.map((i: any) => i.value).join('\n');
    }
  } catch(e) { console.error(e); }

  // --- Section 4: 图片描述 ---
  // Answer processing: remove html tags
  let s4Ans = '';
  try {
    const res = await fetch(`${root}/5/content2.json`);
    if (res.ok) {
      const json = await res.json();
      const rawStd = json.info.std || [];
      const joined = rawStd.map((i: any) => i.value).join('\n');
      s4Ans = joined.replace(/<p>|<\/p>|<br\/>/g, '');
    }
  } catch(e) { console.error(e); }

  // --- Section 5: 快速应答 ---
  const s5Ans: string[] = ['', '', '', ''];
  const s5Questions: string[] = ['', '', '', '']; // Actual questions for AI
  try {
    const res = await fetch(`${root}/6/content2.json`);
    if (res.ok) {
      const json = await res.json();
      for(let i=0; i<4; i++) {
        const std = json.info.question?.[i]?.std || [];
        s5Ans[i] = std.map((item: any) => item.value).join('\n');
        // Store actual question text for AI
        s5Questions[i] = json.info.question?.[i]?.ask || '';
      }
    }
  } catch (e) { console.error(e); }

  // --- Section 6: 简述和问答 ---
  let s6CombinedText = '';
  let s6q1Ans = '', s6q2Ans = '';
  let s6OriginalText = '';
  let s6q1Keywords: string[] = [];
  let s6q2Keywords: string[] = [];
  let s6q1Ask = '', s6q2Ask = '';

  try {
    const res = await fetch(`${root}/7/content2.json`);
    if (res.ok) {
      const json = await res.json();
      s6OriginalText = json.info.value || ''; // Original article
      s6q1Ask = json.info.question?.[0]?.ask || '';
      s6q2Ask = json.info.question?.[1]?.ask || '';
      s6CombinedText = `${s6q1Ask}\n\n${s6q2Ask}`;

      // Answers
      const std1 = json.info.question?.[0]?.std || [];
      s6q1Ans = std1.map((i: any) => i.value).join('\n');

      const std2 = json.info.question?.[1]?.std || [];
      s6q2Ans = std2.map((i: any) => i.value).join('\n');

      // Keywords
      const kw1 = json.info.question?.[0]?.keywords || [];
      s6q1Keywords = kw1.map((i:any) => i.value);

      const kw2 = json.info.question?.[1]?.keywords || [];
      s6q2Keywords = kw2.map((i:any) => i.value);
    }
  } catch(e) { console.error(e); }


  return [
    {
      id: 'sec_1',
      title: '第一部分：朗读句子',
      description: '请朗读屏幕上的句子。',
      directionVideoUrl: '/assets/template/1.mp4',
      questions: [
        { 
          id: 'q1_1', label: '第一题', 
          promptText: s1q1Text, 
          mediaType: 'none', 
          prepDuration: 30, answerDuration: 15, mediaUrls: [],
          answerType: 'audio', answerContent: `${root}/1/material/content.mp3`
        },
        { 
          id: 'q1_2', label: '第二题', 
          promptText: s1q2Text, 
          mediaType: 'none', 
          prepDuration: 30, answerDuration: 15, mediaUrls: [],
          answerType: 'audio', answerContent: `${root}/2/material/content.mp3`
        },
      ],
    },
    {
      id: 'sec_2',
      title: '第二部分：朗读段落',
      description: '请朗读屏幕上的段落。',
      directionVideoUrl: '/assets/template/2.mp4',
      questions: [
        { 
          id: 'q2_1', label: '段落朗读', 
          promptText: s2Text, 
          mediaType: 'none', 
          prepDuration: 60, answerDuration: 30, mediaUrls: [],
          answerType: 'audio', answerContent: `${root}/3/material/content.mp3`
        },
      ],
    },
    {
      id: 'sec_3',
      title: '第三部分：情景提问',
      description: '根据信息进行提问。',
      directionVideoUrl: '/assets/template/3.mp4',
      questions: [
        { 
          id: 'q3_1', label: '第一题', 
          promptText: s3q1Text, 
          mediaType: 'audio', 
          prepDuration: 0, answerDuration: 20, 
          mediaUrls: [`${root}/4/material/ques1askaudio.mp3`],
          answerType: 'text', answerContent: s3q1Ans,
          gradingContext: { refAnswers: s3q1RefAnswers }
        },
        { 
          id: 'q3_2', label: '第二题', 
          promptText: s3q2Text, 
          mediaType: 'audio', 
          prepDuration: 0, answerDuration: 20, 
          mediaUrls: [`${root}/4/material/ques2askaudio.mp3`],
          answerType: 'text', answerContent: s3q2Ans,
          gradingContext: { refAnswers: [s3q2Ans] } // Usually Q2 answer is simple, just wrap
        },
      ],
    },
    {
      id: 'sec_4',
      title: '第四部分：图片描述',
      description: '请描述屏幕上的图片。',
      directionVideoUrl: '/assets/template/4.mp4',
      questions: [
        { 
          id: 'q4_1', label: '图片描述', 
          promptText: 'Describe the picture below in detail.', 
          mediaType: 'image', 
          prepDuration: 60, answerDuration: 60, 
          mediaUrls: [`${root}/5/material/content.jpg`],
          answerType: 'text', answerContent: s4Ans
        },
      ],
    },
    {
      id: 'sec_5',
      title: '第五部分：快速应答',
      description: '观看视频并快速回答问题。',
      directionVideoUrl: '/assets/template/5.mp4',
      questions: [
        { id: 'q5_1', label: '第一题', promptText: 'Listen and answer.', mediaType: 'video', prepDuration: 0, answerDuration: 5, mediaUrls: [`${root}/6/material/ques1askvideo.mp4`], answerType: 'text', answerContent: s5Ans[0], gradingContext: { actualQuestion: s5Questions[0] } },
        { id: 'q5_2', label: '第二题', promptText: 'Listen and answer.', mediaType: 'video', prepDuration: 0, answerDuration: 5, mediaUrls: [`${root}/6/material/ques2askvideo.mp4`], answerType: 'text', answerContent: s5Ans[1], gradingContext: { actualQuestion: s5Questions[1] } },
        { id: 'q5_3', label: '第三题', promptText: 'Listen and answer.', mediaType: 'video', prepDuration: 0, answerDuration: 5, mediaUrls: [`${root}/6/material/ques3askvideo.mp4`], answerType: 'text', answerContent: s5Ans[2], gradingContext: { actualQuestion: s5Questions[2] } },
        { id: 'q5_4', label: '第四题', promptText: 'Listen and answer.', mediaType: 'video', prepDuration: 0, answerDuration: 5, mediaUrls: [`${root}/6/material/ques4askvideo.mp4`], answerType: 'text', answerContent: s5Ans[3], gradingContext: { actualQuestion: s5Questions[3] } },
      ],
    },
    {
      id: 'sec_6',
      title: '第六部分：简述和问答',
      description: '阅读文本并回答相关问题。',
      directionVideoUrl: '/assets/template/6.mp4',
      questions: [
        {
          id: 'q6_1',
          label: '简述',
          promptText: s6q1Ask,
          mediaType: 'audio',
          prepDuration: 30,
          answerDuration: 30,
          mediaUrls: [`${root}/7/material/content.mp3`, `${root}/7/material/ques1askaudio.mp3`],
          answerType: 'text', answerContent: s6q1Ans,
          gradingContext: { originalText: s6OriginalText, keywords: s6q1Keywords }
        },
        {
          id: 'q6_2',
          label: '问答',
          promptText: s6q2Ask,
          mediaType: 'audio',
          prepDuration: 60,
          answerDuration: 60,
          mediaUrls: [`${root}/7/material/ques2askaudio.mp3`],
          answerType: 'text', answerContent: s6q2Ans,
          gradingContext: { originalText: s6OriginalText, keywords: s6q2Keywords }
        },
      ],
    },
  ];
};