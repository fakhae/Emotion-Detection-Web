// Constants
const API_URL = 'http://localhost:8000/api';
const API_BASE_URL = 'http://localhost:8000';

// Emotion mapping
const emotionEmojis = {
    happy: '😊',
    sad: '😢',
    angry: '😠',
    surprised: '😮',
    neutral: '😐',
    fear: '😨',
    disgust: '🤢'
};

// Camera state management
let currentStream = null;
let currentMode = null; // 'register' or 'attendance'

// Track attendance for live detection
let attendanceMarkedFor = null;
let lastAttendanceInfo = null;

function resetAttendanceState() {
    attendanceMarkedFor = null;
    lastAttendanceInfo = null;
}

// Tab management
function showTab(tabId) {
    // Update active tab
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.getElementById(tabId + 'Tab').classList.add('active');

    // Show active content
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('show', 'active');
    });
    document.getElementById(tabId).classList.add('show', 'active');

    // Stop camera if it's running
    stopCamera();
    resetAttendanceState();
}

// Debug helper function
function debugLog(message, obj = null) {
    const timestamp = new Date().toISOString().slice(11, 19);
    if (obj) {
        console.log(`[${timestamp}] ${message}`, obj);
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
}

// MediaPipe Face Detection initialization
let faceDetection;
let lastProcessingTime = 0;
const PROCESSING_INTERVAL = 50; // 50ms between face detections
let animationFrameId = null;

async function initializeFaceDetection() {
    if (!faceDetection) {
        faceDetection = new FaceDetection({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`;
            }
        });

        faceDetection.setOptions({
            model: 'short',
            minDetectionConfidence: 0.5
        });

        await faceDetection.initialize();
    }
}

// Modified startCamera function
async function startCamera(mode) {
    try {
        debugLog(`Starting camera for ${mode} mode`);
        currentMode = mode;
        const prefix = mode === 'register' ? 'reg' : 'att';
        
        await initializeFaceDetection();
        
        const video = document.getElementById(`${prefix}Video`);
        const captureBtn = document.getElementById(`${prefix}CaptureBtn`);
        const startCameraBtn = document.getElementById(`${prefix}StartCamera`);
        
        if (!video) {
            debugLog('ERROR: Video element not found');
            return;
        }
        
        startCameraBtn.style.display = 'none';
        video.style.display = 'block';
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: "user"
            }
        });
        
        debugLog('Camera stream obtained');
        currentStream = stream;
        
        video.srcObject = stream;
        await video.play();
        
        debugLog('Video playing');
        captureBtn.classList.remove('hidden');
        
        // Start real-time face tracking
        startRealtimeFaceTracking(video, prefix);
    } catch (error) {
        debugLog('ERROR accessing camera:', error);
        alert('Failed to access camera. Please check permissions.');
    }
}

// Real-time face tracking function
async function startRealtimeFaceTracking(video, prefix) {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    const detectFace = async () => {
        if (!currentStream) return;

        const currentTime = performance.now();
        if (currentTime - lastProcessingTime >= PROCESSING_INTERVAL) {
            try {
                const faces = await faceDetection.detect(video);
                
                if (faces.detections && faces.detections.length > 0) {
                    const face = faces.detections[0];
                    const box = face.boundingBox;
                    
                    // Update face box position immediately
                    updateFaceBox(prefix, box, true);
                    
                    // Process emotion and identity if in live detection mode
                    if (isLiveDetectionActive) {
                        await processDetection(video, face);
                    }
                } else {
                    updateFaceBox(prefix, null, false);
                }
                
                lastProcessingTime = currentTime;
            } catch (error) {
                debugLog('Face detection error:', error);
            }
        }
        
        animationFrameId = requestAnimationFrame(detectFace);
    };

    detectFace();
}

// Update face detection box position
function updateFaceBox(prefix, box, faceDetected) {
    const faceBox = document.getElementById(`${prefix}FaceBox`);
    if (!faceBox) return;

    if (faceDetected && box) {
        faceBox.style.display = 'block';
        faceBox.style.left = `${box.xCenter * 100}%`;
        faceBox.style.top = `${box.yCenter * 100}%`;
        faceBox.style.width = `${box.width * 100}%`;
        faceBox.style.height = `${box.height * 100}%`;
        faceBox.style.borderColor = '#28a745';
        faceBox.classList.remove('searching');
    } else {
        faceBox.style.borderColor = '#dc3545';
        faceBox.classList.add('searching');
    }
}

// Process detection for emotion and identity
const processDetection = throttle(async (video, face) => {
    try {
        // Capture current frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        
        // Compress image
        const imageBlob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.6);
        });

        // Make API calls in parallel
        const [emotionResponse, identityResponse] = await Promise.all([
            fetch(`${API_URL}/detect-emotion`, {
                method: 'POST',
                body: createFormData(imageBlob, 'emotion')
            }),
            !cachedIdentity && fetch(`${API_URL}/identify-person`, {
                method: 'POST',
                body: createFormData(imageBlob, 'identity')
            })
        ].filter(Boolean));

        // Process emotion result
        const emotionData = await emotionResponse.json();
        
        // Process identity result if not cached
        let identityData = cachedIdentity;
        if (!cachedIdentity && identityResponse) {
            identityData = await identityResponse.json();
            if (identityData.status === 'success' && identityData.name) {
                cachedIdentity = identityData;
            }
        }

        // Update UI
        updateDetectionResults(emotionData, identityData);
        
    } catch (error) {
        debugLog('Detection processing error:', error);
    }
}, 100);

// Update detection results display
function updateDetectionResults(emotion, identity) {
    const resultsContainer = document.getElementById('detectionResults');
    if (!resultsContainer) return;

    resultsContainer.classList.remove('hidden');

    if (emotion && emotion.status === 'success') {
        const emoji = emotionEmojis[emotion.dominant_emotion.toLowerCase()] || '😐';
        document.getElementById('emotionDisplay').textContent = `${emotion.dominant_emotion} ${emoji}`;
    }

    if (identity && identity.status === 'success') {
        document.getElementById('identityDisplay').textContent = identity.name;
    }
}

// Camera functions
async function stopCamera() {
    if (currentStream) {
        debugLog('Stopping camera');
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    resetAttendanceState();
}

async function captureImage() {
    if (!currentMode) return;
    
    const prefix = currentMode === 'register' ? 'reg' : 'att';
    debugLog(`Capturing image for ${currentMode}`);
    
    // Get DOM elements
    const video = document.getElementById(`${prefix}Video`);
    const previewContainer = document.getElementById(`${prefix}PreviewContainer`);
    const previewImage = document.getElementById(`${prefix}PreviewImage`);
    const captureBtn = document.getElementById(`${prefix}CaptureBtn`);
    const retakeBtn = document.getElementById(`${prefix}RetakeBtn`);
    
    // Create canvas and draw image
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    // Store as Data URL instead of blob URL
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    document.getElementById(`${prefix}ImageBlob`).value = dataUrl;
    
    // Update UI
    video.style.display = 'none';
    captureBtn.classList.add('hidden');
    previewImage.src = dataUrl;
    previewContainer.classList.remove('hidden');
    retakeBtn.classList.remove('hidden');
    
    // Stop camera
    stopCamera();
}

function retakeImage() {
    if (!currentMode) return;
    
    const prefix = currentMode === 'register' ? 'reg' : 'att';
    debugLog(`Retaking image for ${currentMode}`);
    
    // Get DOM elements
    const video = document.getElementById(`${prefix}Video`);
    const previewContainer = document.getElementById(`${prefix}PreviewContainer`);
    const retakeBtn = document.getElementById(`${prefix}RetakeBtn`);
    
    // Clear previous image
    document.getElementById(`${prefix}ImageBlob`).value = '';
    previewContainer.classList.add('hidden');
    retakeBtn.classList.add('hidden');
    
    // Restart camera
    startCamera(currentMode);
}

// Add throttle utility function
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Helper function to create FormData
function createFormData(blob, type) {
    const formData = new FormData();
    formData.append('image', blob, 'capture.jpg');
    formData.append('type', type);
    return formData;
}

// Auto-detection functionality
let autoDetectionActive = false;
let autoDetectionInterval = null;
const AUTO_DETECTION_INTERVAL = 1500; // Check every 1.5 seconds

async function startAutoDetection() {
    if (autoDetectionActive || !currentStream) return;
    
    autoDetectionActive = true;
    
    // Show auto-detection status
    const autoDetectStatus = document.getElementById('autoDetectStatus');
    if (autoDetectStatus) {
        autoDetectStatus.classList.remove('hidden');
    }
    
    // Start face tracking
    await startFaceTracking();
    
    // Start continuous detection
    async function detectContinuously() {
        try {
            // Capture frame
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const video = document.getElementById('attVideo');
            
            if (!video) {
                console.error('Video element not found');
                return;
            }
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            faceTrackingActive = true;
            
            // Create image from canvas
            const imageBlob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', 0.9);
            });
            
            // Process detected face
            await processDetectedFace(imageBlob);
            
            // Stop auto-detection after processing
            autoDetectionActive = false;
            
            // Hide status
            if (autoDetectStatus) {
                autoDetectStatus.classList.add('hidden');
            }
            
            // Reset face tracking
            stopFaceTracking();
            
        } catch (error) {
            console.error('Error in auto-detection:', error);
            autoDetectionActive = false;
            if (autoDetectStatus) {
                autoDetectStatus.classList.add('hidden');
            }
        }
    }
    
    // Start detection
    detectContinuously();
}

async function processDetectedFace(blob) {
    try {
        // Show processing section
        const processingSection = document.getElementById('processingSection');
        const resultSection = document.getElementById('resultSection');
        resultSection.classList.add('hidden');
        processingSection.classList.remove('hidden');
        
        // Update progress
        updateProgress(30, 'Processing...');
        
        // Submit to backend
        const formData = new FormData();
        formData.append('image', blob, 'attendance.jpg');
        
        const response = await fetch(`${API_URL}/attendance`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Attendance failed');
        const data = await response.json();

        // Show result
        showResult(data);
        
        // Hide processing section
        processingSection.classList.add('hidden');
        
        // Hide video and buttons
        document.getElementById('attVideo').style.display = 'none';
        document.getElementById('attCaptureBtn').classList.add('hidden');
        document.getElementById('autoDetectBtn').classList.add('hidden');
        document.getElementById('attRetakeBtn').classList.add('hidden');
        
        // Hide status
        document.getElementById('autoDetectStatus').classList.add('hidden');
    } catch (error) {
        console.error('Error processing detected face:', error);
        alert('Failed to mark attendance. Please try again.');
        
        // Hide processing section
        const processingSection = document.getElementById('processingSection');
        processingSection.classList.add('hidden');
        
        // Show error message
        const resultSection = document.getElementById('resultSection');
        resultSection.classList.remove('hidden');
        const resultMessage = document.getElementById('resultMessage');
        resultMessage.textContent = 'Error: ' + error.message;
        resultMessage.style.color = 'red';
    }
}

// Face tracking variables
let faceTrackingActive = false;
let faceTrackingInterval = null;

async function startFaceTracking() {
    if (faceTrackingActive || !isLiveDetectionActive) return;
    
    const prefix = currentMode === 'register' ? 'reg' : 'att';
    const video = document.getElementById(`${prefix}Video`);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    faceTrackingActive = true;
    
    // Create or get emotion display element
    let emotionDisplay = document.getElementById(`${prefix}EmotionDisplay`);
    if (!emotionDisplay) {
        emotionDisplay = document.createElement('div');
        emotionDisplay.id = `${prefix}EmotionDisplay`;
        emotionDisplay.className = 'emotion-display';
        video.parentElement.appendChild(emotionDisplay);
    }
    
    async function detectFace() {
        if (!faceTrackingActive || !isLiveDetectionActive) {
            stopFaceTracking();
            return;
        }
        
        // Schedule next detection immediately to allow concurrency
        requestAnimationFrame(detectFace);
        
        // Capture and send detection request concurrently
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
            try {
                const formData = new FormData();
                formData.append('image', blob);
                const response = await fetch(`${API_URL}/detect_face`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error('Face detection failed');
                const data = await response.json();

                // Update face detection box and emotion display
                const faceDetectionBox = document.getElementById(`${prefix}FaceDetectionBox`);
                if (faceDetectionBox) {
                    if (data.face_detected) {
                        // Calculate scaled coordinates
                        const videoWidth = video.offsetWidth;
                        const videoHeight = video.offsetHeight;
                        const scaleX = videoWidth / video.videoWidth;
                        const scaleY = videoHeight / video.videoHeight;
                        
                        // Mirror the x-coordinate for the display
                        const x = videoWidth - (data.face_box.x * scaleX) - (data.face_box.width * scaleX);
                        const y = data.face_box.y * scaleY;
                        const width = data.face_box.width * scaleX;
                        const height = data.face_box.height * scaleY;
                        
                        // Update box position with smooth transition
                        faceDetectionBox.style.transition = 'all 0.1s ease-out';
                        faceDetectionBox.style.left = `${x}px`;
                        faceDetectionBox.style.top = `${y}px`;
                        faceDetectionBox.style.width = `${width}px`;
                        faceDetectionBox.style.height = `${height}px`;
                        
                        faceDetectionBox.style.display = 'block';
                        faceDetectionBox.classList.remove('searching');
                        faceDetectionBox.classList.add('detected');
                        
                        // Attendance logic:
                        if (data.name && data.name !== 'Unknown' && attendanceMarkedFor !== data.name) {
                            // Mark attendance for this user
                            const attFormData = new FormData();
                            attFormData.append('image', blob);
                            try {
                                const attResp = await fetch(`${API_URL}/attendance`, {
                                    method: 'POST',
                                    body: attFormData
                                });
                                if (attResp.ok) {
                                    const attData = await attResp.json();
                                    lastAttendanceInfo = attData;
                                    attendanceMarkedFor = attData.name;
                                    showStatusMessage('Attendance marked successfully!', 'success');
                                }
                            } catch (err) {
                                console.error('Attendance API error:', err);
                            }
                        }
                        
                        // Update name and emotion display (live detection)
                        let displayText = '';
                        const nameToShow = (lastAttendanceInfo && lastAttendanceInfo.name) || data.name;
                        if (nameToShow) {
                            displayText += `<div class="name">${nameToShow}</div>`;
                        }
                        const emoToShow = (lastAttendanceInfo && lastAttendanceInfo.emotion) || data.emotion;
                        if (emoToShow) {
                            displayText += `<div class="emotion">${emoToShow} ${emotionEmojis[emoToShow] || ''}</div>`;
                        }
                        emotionDisplay.innerHTML = displayText;
                        emotionDisplay.style.display = displayText ? 'block' : 'none';
                        emotionDisplay.style.left = `${x}px`;
                        emotionDisplay.style.top = `${y + height + 5}px`;
                        emotionDisplay.style.width = `${width}px`;
                    } else {
                        // Show searching box in center
                        const containerWidth = video.offsetWidth;
                        const containerHeight = video.offsetHeight;
                        const boxWidth = Math.round(containerWidth * 0.3);
                        const boxHeight = Math.round(containerHeight * 0.4);
                        
                        // Center the box
                        const left = Math.round((containerWidth - boxWidth) / 2);
                        const top = Math.round((containerHeight - boxHeight) / 2);
                        
                        // Update box position with smooth transition
                        faceDetectionBox.style.transition = 'all 0.3s ease-out';
                        faceDetectionBox.style.width = `${boxWidth}px`;
                        faceDetectionBox.style.height = `${boxHeight}px`;
                        faceDetectionBox.style.left = `${left}px`;
                        faceDetectionBox.style.top = `${top}px`;
                        
                        faceDetectionBox.style.display = 'block';
                        faceDetectionBox.classList.remove('detected');
                        faceDetectionBox.classList.add('searching');
                        
                        // Hide emotion display
                        emotionDisplay.style.display = 'none';
                        
                        // Reset attendance info if no face
                        lastAttendanceInfo = null;
                    }
                }
            } catch (err) {
                console.error('Face detection error:', err);
            }
        }, 'image/jpeg', 0.8);
    }
    
    // Start detection loop
    detectFace();
}

function stopFaceTracking() {
    faceTrackingActive = false;
    if (faceTrackingInterval) {
        clearInterval(faceTrackingInterval);
        faceTrackingInterval = null;
    }
    
    // Hide face detection box
    const prefix = currentMode === 'register' ? 'reg' : 'att';
    const faceDetectionBox = document.getElementById(`${prefix}FaceDetectionBox`);
    if (faceDetectionBox) {
        faceDetectionBox.style.display = 'none';
        faceDetectionBox.classList.remove('searching', 'detected');
    }
}

// Update camera initialization to not start face tracking automatically
async function initializeAttendanceCamera() {
    try {
        debugLog('Initializing attendance camera');
        currentMode = 'attendance';
        
        const video = document.getElementById('attVideo');
        const captureBtn = document.getElementById('attCaptureBtn');
        const startCameraBtn = document.getElementById('attStartCamera');
        const autoDetectBtn = document.getElementById('autoDetectBtn');
        const liveDetectBtn = document.getElementById('liveDetectBtn');
        
        // Hide start camera button, show video
        startCameraBtn.style.display = 'none';
        video.style.display = 'block';
        
        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: false,
            video: true
        });
        
        currentStream = stream;
        video.srcObject = stream;
        
        video.onloadedmetadata = function() {
            video.play().then(() => {
                // Show control buttons
                captureBtn.classList.remove('hidden');
                autoDetectBtn.classList.remove('hidden');
                liveDetectBtn.classList.remove('hidden');
            }).catch(err => {
                debugLog('ERROR playing video:', err);
            });
        };
        
    } catch (error) {
        debugLog('ERROR initializing camera:', error);
        alert('Failed to access camera. Please check permissions.');
    }
}

// Add live detection button handler
let isLiveDetectionActive = false;

async function toggleLiveDetection() {
    const liveDetectBtn = document.getElementById('liveDetectBtn');
    
    if (!isLiveDetectionActive) {
        // Start live detection
        isLiveDetectionActive = true;
        liveDetectBtn.textContent = 'Stop Live Detection';
        liveDetectBtn.classList.add('active');
        startFaceTracking();
    } else {
        // Stop live detection
        isLiveDetectionActive = false;
        liveDetectBtn.textContent = 'Start Live Detection';
        liveDetectBtn.classList.remove('active');
        stopFaceTracking();
    }
}

// Form submission handlers
async function handleRegistrationFormSubmit(e) {
    e.preventDefault();
    debugLog('Registration form submitted');
    
    const imageBlob = document.getElementById('regImageBlob').value;
    if (!imageBlob) {
        alert('Please capture your image first');
        return;
    }
    
    try {
        // Convert data URL to blob
        const response = await fetch(imageBlob);
        const blob = await response.blob();
        
        // Create form data
        const formData = new FormData();
        formData.append('name', document.getElementById('name').value);
        formData.append('email', document.getElementById('email').value);
        formData.append('phone', document.getElementById('phone').value);
        formData.append('image', blob, 'face.jpg');
        
        // Submit to backend
        const result = await fetch(`${API_URL}/register`, {
            method: 'POST',
            body: formData
        });
        
        if (result.ok) {
            const data = await result.json();
            alert('Registration successful!');
            
            // Reset form
            document.getElementById('registrationForm').reset();
            document.getElementById('regVideo').style.display = 'none';
            document.getElementById('regCaptureBtn').classList.add('hidden');
            document.getElementById('regPreviewContainer').classList.add('hidden');
            document.getElementById('regRetakeBtn').classList.add('hidden');
            document.getElementById('regStartCamera').style.display = 'block';
            
            // Stay on registration tab
            showTab('register');
        } else {
            throw new Error('Registration failed');
        }
    } catch (error) {
        console.error('Error during registration:', error);
        alert('Registration failed. Please try again.');
    }
}

async function handleAttendanceFormSubmit(e) {
    e.preventDefault();
    debugLog('Attendance form submitted');
    
    const imageBlob = document.getElementById('attImageBlob').value;
    if (!imageBlob) {
        alert('Please capture your image first');
        return;
    }
    
    try {
        // Show processing section
        const processingSection = document.getElementById('processingSection');
        const resultSection = document.getElementById('resultSection');
        resultSection.classList.add('hidden');
        processingSection.classList.remove('hidden');
        
        // Convert data URL to blob
        const response = await fetch(imageBlob);
        const blob = await response.blob();
        
        // Create form data
        const formData = new FormData();
        formData.append('image', blob, 'attendance.jpg');
        
        // Simulate processing steps
        updateProgress(30, 'Detecting face...');
        await new Promise(resolve => setTimeout(resolve, 500));
        updateProgress(50, 'Analyzing features...');
        await new Promise(resolve => setTimeout(resolve, 500));
        updateProgress(70, 'Matching with database...');
        await new Promise(resolve => setTimeout(resolve, 500));
        updateProgress(90, 'Processing emotion...');
        
        // Submit to backend
        const result = await fetch(`${API_URL}/attendance`, {
            method: 'POST',
            body: formData
        });
        
        if (result.ok) {
            updateProgress(100, 'Complete!');
            const data = await result.json();
            showResult(data);
            
            // Reset form but keep the image
            document.getElementById('attVideo').style.display = 'none';
            document.getElementById('attCaptureBtn').classList.add('hidden');
        } else {
            // Handle specific error cases
            const errorData = await result.json();
            if (result.status === 404) {
                updateProgress(100, 'User not recognized');
                document.getElementById('processingSection').classList.add('hidden');
                alert('User not recognized. Please register first or try again.');
            } else {
                throw new Error(errorData.detail || 'Failed to mark attendance');
            }
        }
    } catch (error) {
        console.error('Error marking attendance:', error);
        alert('Failed to mark attendance. Please try again.');
        document.getElementById('processingSection').classList.add('hidden');
    }
}

// Attendance processing helpers
function updateProgress(percent, status) {
    const bar = document.getElementById('processingBar');
    const statusEl = document.getElementById('processingStatus');
    if (bar) bar.style.width = `${percent}%`;
    if (statusEl) statusEl.textContent = status;
}

function showResult(data) {
    const processingSection = document.getElementById('processingSection');
    const resultSection = document.getElementById('resultSection');
    if (processingSection) processingSection.classList.add('hidden');
    if (!resultSection) return;
    document.getElementById('userName').textContent = data.name || '-';
    document.getElementById('userEmail').textContent = data.email || '-';
    document.getElementById('emotionEmoji').textContent = emotionEmojis[data.emotion] || '';
    document.getElementById('emotionText').textContent = data.emotion || '';
    const timeStr = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    document.getElementById('attendanceTime').textContent = timeStr;
    resultSection.classList.remove('hidden');
}

// Show status message (success/error/info)
function showStatusMessage(msg, type='success') {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.textContent = msg;
    statusDiv.className = type; // Use CSS for .success, .error, etc.
    statusDiv.style.display = 'block';
    setTimeout(() => { statusDiv.style.display = 'none'; }, 3000); // auto-hide after 3s
}

// Initialize camera buttons
function handleRegStartCameraClick() {
    debugLog('Registration camera button clicked');
    startCamera('register');
}

function handleAttStartCameraClick() {
    debugLog('Attendance camera button clicked');
    initializeAttendanceCamera();
}

// Set up capture buttons
function handleRegCaptureBtnClick() {
    captureImage();
}

function handleAttCaptureBtnClick() {
    captureImage();
}

// Set up retake buttons
function handleRegRetakeBtnClick() {
    retakeImage();
}

function handleAttRetakeBtnClick() {
    retakeImage();
}

// Set up auto-detect button
function handleAutoDetectBtnClick() {
    startAutoDetection();
}

// Set up live detect button
function handleLiveDetectBtnClick() {
    toggleLiveDetection();
}

// Initialize hidden inputs on page load
document.addEventListener('DOMContentLoaded', function() {
    debugLog('DOM fully loaded');
    
    // Tab management
    document.getElementById('registerTab').addEventListener('click', function(e) {
        e.preventDefault();
        showTab('register');
    });
    document.getElementById('attendanceTab').addEventListener('click', function(e) {
        e.preventDefault();
        showTab('attendance');
    });
    
    // Camera buttons
    document.getElementById('regStartCamera').addEventListener('click', handleRegStartCameraClick);
    document.getElementById('attStartCamera').addEventListener('click', handleAttStartCameraClick);
    // Capture buttons
    document.getElementById('regCaptureBtn').addEventListener('click', handleRegCaptureBtnClick);
    document.getElementById('attCaptureBtn').addEventListener('click', handleAttCaptureBtnClick);
    // Retake buttons
    document.getElementById('regRetakeBtn').addEventListener('click', handleRegRetakeBtnClick);
    document.getElementById('attRetakeBtn').addEventListener('click', handleAttRetakeBtnClick);
    // Auto-detect and live-detect
    document.getElementById('autoDetectBtn').addEventListener('click', handleAutoDetectBtnClick);
    document.getElementById('liveDetectBtn').addEventListener('click', handleLiveDetectBtnClick);
    
    // Create hidden inputs for image blobs if they don't exist
    if (!document.getElementById('regImageBlob')) {
        const regInput = document.createElement('input');
        regInput.type = 'hidden';
        regInput.id = 'regImageBlob';
        document.getElementById('registrationForm').appendChild(regInput);
    }
    if (!document.getElementById('attImageBlob')) {
        const attInput = document.createElement('input');
        attInput.type = 'hidden';
        attInput.id = 'attImageBlob';
        document.getElementById('attendanceForm').appendChild(attInput);
    }
    
    // Form submission handlers
    document.getElementById('registrationForm').addEventListener('submit', handleRegistrationFormSubmit);
    document.getElementById('attendanceForm').addEventListener('submit', handleAttendanceFormSubmit);
});
