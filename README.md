# Emotion Detection Web App

A web application for face detection and emotion recognition using Face API and TensorFlow.js.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the backend server:
```bash
python -m uvicorn backend.main:app --reload
```

3. Open the application in your browser:
   - Navigate to: http://localhost:8000

## Features

- Multi-angle face registration (front, left, right, top, bottom)
- Real-time face detection
- Emotion recognition
- User attendance tracking
- Modern and responsive UI

## Browser Support

The application requires:
- A modern browser with WebRTC support
- Camera access permissions
- JavaScript enabled
- Internet connection (for loading Face API models)

## Troubleshooting

1. Camera Issues:
   - Make sure your browser has permission to access the camera
   - Check if another application is using the camera
   - Try refreshing the page
   - If camera doesn't work, check the browser console for error messages

2. Face Detection Issues:
   - Ensure good lighting conditions
   - Position your face within the frame
   - Check if Face API models are loaded (loading indicator should disappear)
   - Make sure you have a stable internet connection

3. Loading Issues:
   - Check your internet connection
   - Clear browser cache and cookies
   - Try using a different browser
   - Check browser console for any error messages

## Technical Stack

- Frontend:
  - HTML5, CSS3, JavaScript
  - Face API.js for face detection
  - TensorFlow.js for machine learning
  - Bootstrap 5 for UI components

- Backend:
  - Python FastAPI
  - User data storage
  - Image processing
  - Emotion detection algorithms
