这是一个上海高考英语听说模拟软件，允许调用Gemini API来实现评分。

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Import Test Data

Test data should be stored as folders under `public` directory, in the same format as in "E听说", like this (unused files are omitted):
├── 1
│   ├── content2.json
│   └── material
│       └── content.mp3
├── 2
│   ├── content2.json
│   └── material
│       └── content.mp3
├── 3
│   ├── content2.json
│   └── material
│       └── content.mp3
├── 4
│   ├── content2.json
│   └── material
│       ├── ques1askaudio.mp3
│       └── ques2askaudio.mp3
├── 5
│   ├── content2.json
│   └── material
│       ├── content.jpg
│       ├── content.mp3
│       ├── content_1.jpg
│       ├── content_2.jpg
│       ├── content_3.jpg
│       └── content_4.jpg
├── 6
│   ├── content2.json
│   └── material
│       ├── ques1askvideo.mp4
│       ├── ques2askvideo.mp4
│       ├── ques3askvideo.mp4
│       └── ques4askvideo.mp4
└── 7
    ├── content2.json
    └── material
        ├── content.mp3
        ├── ques1askaudio.mp3
        └── ques2askaudio.mp3

Then, edit the `TEST_SETS` array in `constants.ts`. Fill the array with **id**(directory name)**-name**(test title) pairs.

10 simulation tests have been uploaded to this repository as examples, except for media files (\*.mp3、\*.mp4) in order to avoid copyright issues.

## Build and deploy

1. Build a production version
   `npm run build`
2. Start a HTTP web service on `dist` folder

\*: Note that testdata hot reload is not supported. Once you add/change the dataset, the webapp needs to be rebuilt.

## Acknowledgements

This app is built on Google AI Studio. It couldn't have been finished so quickly without the help of Gemini 3 Pro Preview model.
