const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let currentPredictions = [];
let isCameraOn = false;
let model = null;
let detectionInterval = null;

let facingMode = "environment"; // default to back camera

document.addEventListener('DOMContentLoaded', () => {
  updateDashboard();
  
  // Load model but don't start camera yet
  cocoSsd.load()
    .then(loadedModel => {
      model = loadedModel;
      console.log('Model loaded successfully.');
    })
    .catch(err => {
      console.error('Failed to load model:', err);
      alert('Failed to load object detection model. Please refresh the page.');
    });
  
  // Set up camera toggle button
  const cameraToggle = document.getElementById('camera-toggle');
  cameraToggle.addEventListener('click', toggleCamera);
  
  document.getElementById('switch-camera').addEventListener('click', () => {
    // Toggle facing mode
    facingMode = (facingMode === "environment") ? "user" : "environment";
    if (isCameraOn) {
      // Restart camera with new facingMode
      stopCamera();
      toggleCamera();
    }
  });
});

function toggleCamera() {
  const cameraToggle = document.getElementById('camera-toggle');
  const video = document.getElementById('webcam');
  
  if (!isCameraOn) {
    video.style.display = 'block';
    document.getElementById('video-placeholder').classList.add('hidden');
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode } })
      .then(stream => {
        video.srcObject = stream;
        isCameraOn = true;
        cameraToggle.textContent = 'Stop Camera';
        
        video.addEventListener('loadedmetadata', () => {
          canvas.width = canvas.clientWidth;
          canvas.height = canvas.clientHeight;
          detectionInterval = setInterval(detectObjects, 500);
        }, { once: true });
      })
      .catch(err => {
        console.error('Error accessing webcam:', err);
        video.style.display = 'none';
        document.getElementById('video-placeholder').classList.remove('hidden');
        alert('Could not access the camera. Please ensure you have granted camera permissions.');
      });
  } else {
    stopCamera();
  }
}

function stopCamera() {
  const video = document.getElementById('webcam');
  const cameraToggle = document.getElementById('camera-toggle');
  
  video.style.display = 'none';
  document.getElementById('video-placeholder').classList.remove('hidden');
  
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  
  isCameraOn = false;
  cameraToggle.textContent = 'Start Camera';
  clearInterval(detectionInterval);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function detectObjects() {
  if (!isCameraOn || !model) return;
  
  model.detect(video)
    .then(predictions => {
      currentPredictions = predictions;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const xScale = canvas.width / video.videoWidth;
      const yScale = canvas.height / video.videoHeight;

      predictions.forEach(p => {
        const [x, y, width, height] = p.bbox;
        ctx.beginPath();
        ctx.rect(
          x * xScale,
          y * yScale,
          width * xScale,
          height * yScale
        );
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'green';
        ctx.stroke();

        ctx.fillStyle = 'green';
        ctx.font = '14px Arial';
        ctx.fillText(
          `${p.class} (${(p.score * 100).toFixed(1)}%)`,
          x * xScale,
          y * yScale > 10 ? y * yScale - 5 : 10
        );
      });
    })
    .catch(err => console.error('Detection error:', err));
}

function showIdeasFor(objClass) {
  fetch('reuseIdeas.json')
    .then(res => res.json())
    .then(data => {
      const ideas = data[objClass] || [];
      const modal = document.getElementById('modal');
      const modalTitle = document.getElementById('modal-title');
      const modalIdeas = document.getElementById('modal-ideas');
      const markBtn = document.getElementById('mark-reused-btn');
      const closeBtn = document.getElementById('modal-close-btn');

      function closeModal() {
        modal.style.display = 'none';
      }

      modalTitle.textContent = `Ideas for ${objClass}`;
      modalIdeas.innerHTML = ideas.length
        ? ideas.map(idea => `<div class="idea-item"><a href="${idea.link}" target="_blank">${idea.title}</a></div>`).join('')
        : '<p>No ideas found.</p>';

      modal.style.display = 'flex';

      markBtn.onclick = () => {
        incrementReuseCount(objClass); 
        closeModal();
      };
      closeBtn.onclick = closeModal;
    })
    .catch(err => console.error('Error loading reuseIdeas.json:', err));
}

function incrementReuseCount(objClass) {
  let stats = JSON.parse(localStorage.getItem('reuseStats') || '{}');
  stats[objClass] = (stats[objClass] || 0) + 1;
  localStorage.setItem('reuseStats', JSON.stringify(stats));
  updateDashboard();
}

function updateDashboard() {
  let stats = JSON.parse(localStorage.getItem('reuseStats') || '{}');
  let total = Object.values(stats).reduce((sum, v) => sum + v, 0);
  document.getElementById('dashboard').textContent = `Items reused: ${total}`;
}

canvas.addEventListener('click', (e) => {
  if (!isCameraOn) return;
  
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  for (let p of currentPredictions) {
    const [x, y, width, height] = p.bbox;
    const xScale = canvas.width / video.videoWidth;
    const yScale = canvas.height / video.videoHeight;
    
    if (clickX >= x * xScale &&
        clickX <= (x + width) * xScale &&
        clickY >= y * yScale &&
        clickY <= (y + height) * yScale) {
      showIdeasFor(p.class);
      return; 
    }
  }
});