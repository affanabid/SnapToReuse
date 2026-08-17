const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('video-container');

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const placeholderMsg = document.getElementById('placeholder-msg');
const cameraToggle = document.getElementById('camera-toggle');
const switchCameraBtn = document.getElementById('switch-camera');
const pauseToggleBtn = document.getElementById('pause-toggle');
const soundToggleBtn = document.getElementById('sound-toggle');
const videoPlaceholder = document.getElementById('video-placeholder');

const fpsCountEl = document.getElementById('fps-count');
const objectCountEl = document.getElementById('object-count');
const engineStateEl = document.getElementById('engine-state');
const recentLogEl = document.getElementById('recent-log');

let currentPredictions = [];
let isCameraOn = false;
let isPaused = false;
let soundEnabled = true;
let model = null;
let animFrameId = null;
let isDetecting = false;
let lastDetectTime = 0;
const DETECT_INTERVAL_MS = 140; // ~7 FPS inference rate for low CPU impact

// FPS calculation
let frameCount = 0;
let lastFpsUpdate = 0;
let currentFps = 12;

let facingMode = "environment"; // default to back camera

document.addEventListener('DOMContentLoaded', () => {
  updateDashboard();
  setupResizeObserver();
  setupDockControls();
  
  // Status: Loading Model
  setStatus('loading', 'loading model...');
  setEngineState('LOADING');
  if (placeholderMsg) placeholderMsg.textContent = 'Initializing AI vision engine... Please wait.';

  // Load model
  cocoSsd.load()
    .then(loadedModel => {
      model = loadedModel;
      setStatus('ready', 'model ready');
      setEngineState('READY');
      if (placeholderMsg) placeholderMsg.textContent = 'Camera is currently off. Click "Start Camera" to begin.';
      if (cameraToggle) cameraToggle.disabled = false;
      if (switchCameraBtn) switchCameraBtn.disabled = false;
    })
    .catch(err => {
      console.error('Failed to load model:', err);
      setStatus('loading', 'model load error');
      setEngineState('ERROR');
      if (placeholderMsg) placeholderMsg.textContent = 'Failed to load vision engine. Please refresh page.';
    });
  
  // Camera Toggle Listener
  if (cameraToggle) {
    cameraToggle.addEventListener('click', toggleCamera);
  }
  
  // Switch Camera Listener
  if (switchCameraBtn) {
    switchCameraBtn.addEventListener('click', () => {
      facingMode = (facingMode === "environment") ? "user" : "environment";
      if (isCameraOn) {
        stopCamera();
        toggleCamera();
      }
    });
  }
});

function setStatus(type, message) {
  if (!statusDot || !statusText) return;
  statusDot.className = `status-dot ${type}`;
  statusText.textContent = message;
}

function setEngineState(state) {
  if (engineStateEl) {
    engineStateEl.textContent = state;
  }
}

function setupDockControls() {
  if (pauseToggleBtn) {
    pauseToggleBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      pauseToggleBtn.querySelector('i').className = isPaused ? 'ti ti-player-play' : 'ti ti-player-pause';
      setEngineState(isPaused ? 'PAUSED' : 'DETECTING');
    });
  }

  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      soundToggleBtn.querySelector('i').className = soundEnabled ? 'ti ti-volume' : 'ti ti-volume-off';
    });
  }
}

function updateCanvasDimensions() {
  if (!container || !canvas) return;
  const rect = container.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
  }
}

function setupResizeObserver() {
  window.addEventListener('resize', updateCanvasDimensions);
  if (window.ResizeObserver && container) {
    const observer = new ResizeObserver(() => updateCanvasDimensions());
    observer.observe(container);
  }
}

function toggleCamera() {
  if (!isCameraOn) {
    if (!model) {
      alert('Please wait for the object detection model to finish loading.');
      return;
    }

    video.style.display = 'block';
    if (videoPlaceholder) videoPlaceholder.style.display = 'none';
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode } })
      .then(stream => {
        video.srcObject = stream;
        video.style.transform = (facingMode === "user") ? "scaleX(-1)" : "none";
        isCameraOn = true;
        
        if (cameraToggle) {
          const btnSpan = cameraToggle.querySelector('span');
          if (btnSpan) btnSpan.textContent = 'Stop Camera';
        }
        
        setStatus('active', 'detecting items');
        setEngineState('DETECTING');
        
        video.addEventListener('loadedmetadata', () => {
          updateCanvasDimensions();
          startRenderLoop();
        }, { once: true });
      })
      .catch(err => {
        console.error('Error accessing webcam:', err);
        video.style.display = 'none';
        if (videoPlaceholder) videoPlaceholder.style.display = 'flex';
        setStatus('ready', 'camera access denied');
        setEngineState('ERROR');
        alert('Could not access camera. Please ensure camera permissions are granted in browser settings.');
      });
  } else {
    stopCamera();
  }
}

function stopCamera() {
  video.style.display = 'none';
  if (videoPlaceholder) videoPlaceholder.style.display = 'flex';
  
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  
  isCameraOn = false;
  if (cameraToggle) {
    const btnSpan = cameraToggle.querySelector('span');
    if (btnSpan) btnSpan.textContent = 'Start Camera';
  }
  
  setStatus('ready', 'camera stopped');
  setEngineState('STANDBY');
  
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  
  currentPredictions = [];
  if (objectCountEl) objectCountEl.textContent = '0';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function startRenderLoop() {
  lastDetectTime = 0;
  frameCount = 0;
  lastFpsUpdate = performance.now();
  
  function loop(timestamp) {
    if (!isCameraOn) return;

    // Calculate FPS
    frameCount++;
    if (timestamp - lastFpsUpdate >= 1000) {
      currentFps = Math.round((frameCount * 1000) / (timestamp - lastFpsUpdate));
      frameCount = 0;
      lastFpsUpdate = timestamp;
      if (fpsCountEl) fpsCountEl.textContent = currentFps.toString();
    }

    // Trigger throttled detection inference
    if (model && !isDetecting && !isPaused && (timestamp - lastDetectTime >= DETECT_INTERVAL_MS)) {
      isDetecting = true;
      lastDetectTime = timestamp;
      
      model.detect(video)
        .then(predictions => {
          currentPredictions = predictions;
          if (objectCountEl) objectCountEl.textContent = predictions.length.toString();
        })
        .catch(err => console.error('Detection error:', err))
        .finally(() => {
          isDetecting = false;
        });
    }

    // Render viewfinder bounding boxes smoothly on every frame
    drawPredictions();

    animFrameId = requestAnimationFrame(loop);
  }

  animFrameId = requestAnimationFrame(loop);
}

function drawPredictions() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!video.videoWidth || !video.videoHeight || currentPredictions.length === 0) return;

  const xScale = canvas.width / video.videoWidth;
  const yScale = canvas.height / video.videoHeight;

  currentPredictions.forEach(p => {
    const [x, y, width, height] = p.bbox;
    const scaledW = width * xScale;
    const scaledH = height * yScale;
    const scaledX = (facingMode === "user")
      ? (video.videoWidth - x - width) * xScale
      : x * xScale;
    const scaledY = y * yScale;

    // 1. Semi-transparent scan fill
    ctx.fillStyle = 'rgba(76, 255, 176, 0.04)';
    ctx.fillRect(scaledX, scaledY, scaledW, scaledH);

    // 2. Viewfinder Reticle Corner Brackets around bounding box
    const bracketLen = Math.min(14, scaledW / 3, scaledH / 3);
    ctx.strokeStyle = '#4CFFB0'; // --accent-scan Mint
    ctx.lineWidth = 2;

    // Top-Left Corner
    ctx.beginPath();
    ctx.moveTo(scaledX, scaledY + bracketLen);
    ctx.lineTo(scaledX, scaledY);
    ctx.lineTo(scaledX + bracketLen, scaledY);
    ctx.stroke();

    // Top-Right Corner
    ctx.beginPath();
    ctx.moveTo(scaledX + scaledW - bracketLen, scaledY);
    ctx.lineTo(scaledX + scaledW, scaledY);
    ctx.lineTo(scaledX + scaledW, scaledY + bracketLen);
    ctx.stroke();

    // Bottom-Left Corner
    ctx.beginPath();
    ctx.moveTo(scaledX, scaledY + scaledH - bracketLen);
    ctx.lineTo(scaledX, scaledY + scaledH);
    ctx.lineTo(scaledX + bracketLen, scaledY + scaledH);
    ctx.stroke();

    // Bottom-Right Corner
    ctx.beginPath();
    ctx.moveTo(scaledX + scaledW - bracketLen, scaledY + scaledH);
    ctx.lineTo(scaledX + scaledW, scaledY + scaledH);
    ctx.lineTo(scaledX + scaledW, scaledY + scaledH - bracketLen);
    ctx.stroke();

    // 3. Label Chip Badge (Mono Font)
    const confidence = Math.round(p.score * 100);
    const scoreText = `${p.class} · ${confidence}%`;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    const textMetrics = ctx.measureText(scoreText);
    const badgePaddingX = 6;
    const badgeHeight = 20;
    const badgeWidth = textMetrics.width + (badgePaddingX * 2);
    
    let badgeY = scaledY - badgeHeight - 4;
    if (badgeY < 4) badgeY = scaledY + 4; // Prevent clipping at top edge

    // Chip Background
    ctx.fillStyle = '#121815';
    ctx.fillRect(scaledX, badgeY, badgeWidth, badgeHeight);
    ctx.strokeStyle = '#2B3630';
    ctx.lineWidth = 1;
    ctx.strokeRect(scaledX, badgeY, badgeWidth, badgeHeight);

    // Chip Text
    ctx.fillStyle = '#4CFFB0';
    ctx.fillText(scoreText, scaledX + badgePaddingX, badgeY + 14);
  });
}

function addLogEntry(item) {
  if (!recentLogEl) return;
  const now = new Date();
  const timeStr = now.toTimeString().substring(0, 5);
  
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${timeStr}</span> <span class="log-item">${item}</span>`;
  
  recentLogEl.insertBefore(entry, recentLogEl.firstChild);
  
  // Limit to last 8 logs
  while (recentLogEl.children.length > 8) {
    recentLogEl.removeChild(recentLogEl.lastChild);
  }
}

function showIdeasFor(objClass) {
  addLogEntry(`${objClass} selected`);
  
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

      modalTitle.textContent = `Upcycling: ${objClass}`;
      modalIdeas.innerHTML = ideas.length
        ? ideas.map(idea => `
            <div class="idea-item ${!idea.link ? 'sarcastic-item' : ''}">
              ${idea.link ? `
                <a href="${idea.link}" target="_blank" rel="noopener noreferrer">
                  <span>${idea.title}</span>
                </a>
              ` : `
                <div class="sarcastic-quote">
                  <span>${idea.title}</span>
                </div>
              `}
            </div>
          `).join('')
        : '<p style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8125rem;">No curated ideas found for this item yet.</p>';

      modal.style.display = 'flex';

      markBtn.onclick = () => {
        incrementReuseCount(objClass); 
        closeModal();
      };

      if (closeBtn) {
        closeBtn.onclick = closeModal;
      }

      // Close on backdrop click
      modal.onclick = (e) => {
        if (e.target === modal) closeModal();
      };
    })
    .catch(err => console.error('Error loading reuseIdeas.json:', err));
}

function incrementReuseCount(objClass) {
  let stats = JSON.parse(localStorage.getItem('reuseStats') || '{}');
  stats[objClass] = (stats[objClass] || 0) + 1;
  localStorage.setItem('reuseStats', JSON.stringify(stats));
  addLogEntry(`${objClass} marked upcycled`);
  updateDashboard();
}

function updateDashboard() {
  let stats = JSON.parse(localStorage.getItem('reuseStats') || '{}');
  let total = Object.values(stats).reduce((sum, v) => sum + v, 0);
  const dashboardEl = document.getElementById('dashboard');
  if (dashboardEl) {
    dashboardEl.textContent = total.toString();
  }
}

function handleCanvasInteraction(clientX, clientY) {
  if (!isCameraOn || isPaused || !video.videoWidth || !video.videoHeight) return;
  
  const rect = canvas.getBoundingClientRect();
  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;

  for (let p of currentPredictions) {
    const [x, y, width, height] = p.bbox;
    const xScale = canvas.width / video.videoWidth;
    const yScale = canvas.height / video.videoHeight;
    const scaledX = (facingMode === "user")
      ? (video.videoWidth - x - width) * xScale
      : x * xScale;
    const scaledW = width * xScale;
    const scaledY = y * yScale;
    const scaledH = height * yScale;
    
    if (clickX >= scaledX &&
        clickX <= scaledX + scaledW &&
        clickY >= scaledY &&
        clickY <= scaledY + scaledH) {
      showIdeasFor(p.class);
      return; 
    }
  }
}

canvas.addEventListener('click', (e) => {
  handleCanvasInteraction(e.clientX, e.clientY);
});

canvas.addEventListener('touchend', (e) => {
  if (e.changedTouches && e.changedTouches.length > 0) {
    const touch = e.changedTouches[0];
    handleCanvasInteraction(touch.clientX, touch.clientY);
  }
});