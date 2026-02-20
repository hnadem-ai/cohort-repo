import { useRef, useState } from 'react';
import './AttachmentMenu.css';
import paperClip from '../images/clip.png';
import Toast from './Toast';

function AttachmentMenu({ setFiles }) {
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    const MAX_FILES = 5;

    const fileInputRef = useRef(null);

    const [toastMessage, setToastMessage] = useState("");
    const [showToast, setShowToast] = useState(false);

    function showAlert(msg) {
        setToastMessage(msg);
        setShowToast(true);
    }

    function handleOpen(e) {
        e.preventDefault();
        fileInputRef.current?.click(); // 🔥 directly open file picker
    }

    function handleFileChange(e) {
        const selectedFiles = Array.from(e.target.files);

        if (selectedFiles.length > MAX_FILES) {
            showAlert("You can only upload up to 5 files.");
            e.target.value = null;
            return;
        }

        const hasInvalidFile = selectedFiles.some(file => {
            if (file.size > MAX_FILE_SIZE) {
                showAlert(`${file.name} exceeds 2MB size limit.`);
                return true;
            }
            return false;
        });

        if (hasInvalidFile) {
            e.target.value = null;
            return;
        }

        setFiles(selectedFiles);
        e.target.value = null;
    }

    return (
        <div className='am-container'>
            <button
                type='button'
                className='am-btn'
                onClick={handleOpen}
            >
                <img className='am-btn-img' src={paperClip} alt="Attach"/>
            </button>

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept='image/*, video/*'
                multiple
                onChange={handleFileChange}
                style={{ display: 'none' }}
            />

            <Toast
                message={toastMessage}
                show={showToast}
                onClose={() => setShowToast(false)}
            />

            <span className='tooltip'>Add Photos or Videos</span>
        </div>
    );
}

export default AttachmentMenu;