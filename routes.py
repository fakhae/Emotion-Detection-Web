import logging
from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from infrastructure.user_manager.user_manager import UserManager
from infrastructure.emotion_detector.fer_detector import DeepFaceEmotionDetector
from typing import List

router = APIRouter()
logger = logging.getLogger(__name__)
user_manager = UserManager()
emotion_detector = DeepFaceEmotionDetector()

async def validate_image(file: UploadFile):
    """Validate uploaded image file"""
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Read file to check if it's valid
    try:
        contents = await file.read()
        await file.seek(0)
        if len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty file")
        return contents
    except Exception as e:
        logger.error(f"File validation error: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid file")

@router.post("/register")
async def register_user(
    name: str = Form(...),
    phone: str = Form(...),
    email: str = Form(...),
    front_image: UploadFile = File(...),
    left_image: UploadFile = File(...),
    right_image: UploadFile = File(...),
    top_image: UploadFile = File(...),
    bottom_image: UploadFile = File(...)
):
    """Register a new user with their face images from multiple angles"""
    try:
        logger.info(f"Processing registration request for user: {name}")
        
        # Validate all images
        front_bytes = await validate_image(front_image)
        left_bytes = await validate_image(left_image)
        right_bytes = await validate_image(right_image)
        top_bytes = await validate_image(top_image)
        bottom_bytes = await validate_image(bottom_image)
        
        # Prepare image dictionary
        face_images = {
            "front": front_bytes,
            "left": left_bytes,
            "right": right_bytes,
            "top": top_bytes,
            "bottom": bottom_bytes
        }
        
        user_data = {"name": name, "phone": phone, "email": email}
        user_manager.register_user_multi_angle(user_data, face_images)
        
        logger.info(f"Successfully registered user: {name}")
        return {"status": "success", "message": "User registered successfully"}
    except ValueError as ve:
        logger.warning(f"Validation error during registration: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to register user: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to register user")

@router.post("/analyze")
async def analyze_emotion(file: UploadFile = File(...)):
    """Analyze emotions in an image and identify the user if registered"""
    try:
        logger.info("Processing emotion analysis request")
        
        # Validate and read image
        image_bytes = await validate_image(file)
        
        try:
            # First try to identify the user
            user_data = user_manager.identify_user(image_bytes)
            
            # Detect emotion
            emotion_result = emotion_detector.detect_emotion(image_bytes)
            all_emotions = emotion_detector.get_all_emotions(image_bytes)
            
            # Prepare response
            response = {
                "status": "success",
                "emotion": emotion_result,
                "all_emotions": all_emotions
            }
            
            # Add user data if found
            if user_data:
                response["user"] = user_data
                logger.info(f"Identified user: {user_data['name']}")
            else:
                logger.info("No user identified")
            
            logger.info(f"Detected emotion: {emotion_result}")
            return response
            
        except ValueError as ve:
            logger.warning(f"Validation error during analysis: {str(ve)}")
            return {
                "status": "error",
                "message": str(ve)
            }
        except Exception as e:
            logger.error(f"Failed to analyze image: {str(e)}")
            return {
                "status": "error",
                "message": "Failed to analyze image"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in analyze_emotion: {str(e)}")
        return {
            "status": "error",
            "message": "Internal server error"
        }

@router.post("/predict")
async def analyze_emotion(file: UploadFile = File(...)):
    """Analyze emotions in an image"""
    try:
        logger.info("Processing emotion prediction request")
        
        # Validate and read image
        image_bytes = await validate_image(file)
        
        try:
            # Detect emotion
            emotion_result = emotion_detector.detect_emotion(image_bytes)
            all_emotions = emotion_detector.get_all_emotions(image_bytes)
            
            logger.info(f"Detected emotion: {emotion_result}")
            return {
                "status": "success",
                "emotion": emotion_result,
                "all_emotions": all_emotions
            }
            
        except Exception as e:
            logger.error(f"Failed to analyze image: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to analyze image")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in analyze_emotion: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")