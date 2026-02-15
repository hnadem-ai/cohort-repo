import './PhotoStep.css';
import Cropper from 'react-easy-crop';
import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { useAuth } from './context/AuthContext';
import Toast from "./components/Toast";
import closeImg from './images/close-gray.png';

export default function ProfilePhotoStep() {
  const navigate = useNavigate();
  const { method, id } = useParams();
  const { accessToken } = useAuth();
  const [preview, setPreview] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const onCropComplete = useCallback((_, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  async function getCroppedImage(imageSrc, cropPixels) {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((res) => (image.onload = res));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = cropPixels.width;
    canvas.height = cropPixels.height;

    ctx.drawImage(
      image,
      cropPixels.x,
      cropPixels.y,
      cropPixels.width,
      cropPixels.height,
      0,
      0,
      cropPixels.width,
      cropPixels.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg');
    });
  }


  function showAlert(msg) {
    setToastMessage(msg);
    setShowToast(true);
  }
  // Handle file drop
  const onDrop = useCallback((acceptedFiles) => {
    const aFile = acceptedFiles?.[0];
    if (!aFile) return;

    setFile(aFile);
    setPreview(URL.createObjectURL(aFile));
  }, []);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const MAX_SIZE = 2 * 1024 * 1024;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
    maxSize: MAX_SIZE,
    onDropRejected: (fileRejections) => {
      fileRejections.forEach((rej) => {
        if (rej.errors[0].code === "file-too-large") {
          showAlert("Your image is larger than 2MB. Pick a smaller file.");
        } else {
          showAlert("Invalid file selected.");
        }
      });
    }
  });

  async function handleUpload() {
    const croppedBlob = await getCroppedImage(preview, croppedAreaPixels);
    if (!preview || !croppedBlob) {
      return showAlert('Please crop your photo!');
    }

    setUploading(true);

    
    const formData = new FormData();
    formData.append('image', croppedBlob, 'profile.jpg');

    if (method !== 'profile') {
      formData.append('chatId', id);
    }

    try {
      const apiUrl =
        method === 'profile'
          ? '/api/upload-user-dp'
          : '/api/upload-chat-dp';

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      setUploading(false);

      if (!res.ok) {
        showAlert('Image not Uploaded!');
        return;
      }

      navigate('/');
    } catch (err) {
      console.error(err);
      navigate('/crash');
    }
  }

  return (
    <div className="profile-photo-step">
      <div className='close-btn-container'>
        <button onClick={() => navigate('/')} className='close-btn'><img src={closeImg}/></button>
      </div>
      <div className='profile-photo-step-body'>
        <div {...getRootProps({ className: 'dropzone' })}>
          <input {...getInputProps()} />
          {isDragActive ? (
            <p>Drop the photo here...</p>
          ) : (
            <p>Drag & drop a photo, or click to select one</p>
          )}
        </div>

        {preview && (
          <div className="crop-container">
            <Cropper
              image={preview}
              crop={crop}
              zoom={zoom}
              aspect={1}          // 1:1 for profile photo
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />

            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
              className="zoom-slider"
            />
          </div>
        )}
        <p className='profile-photo-step-note'>Note: Your image should be under 2MB.</p>
        <button type='button' onClick={handleUpload} className="upload-btn">
          { uploading ? (
              <div className='spinner' style={{width: '20px', height: '20px', borderColor: '#171718'}}></div>
            ) : (
              'Upload Photo'
            )
          }
        </button>
        <Toast
          message={toastMessage}
          show={showToast}
          onClose={() => setShowToast(false)}
        />
      </div>
    </div>
  );
}
