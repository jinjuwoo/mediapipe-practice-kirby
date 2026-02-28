import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs";

const video = document.getElementById("webcam");
const pipVideo = document.getElementById("pip-webcam");

const pipCanvas = document.getElementById("pip-canvas");
const pipCtx = pipCanvas.getContext("2d");
pipCanvas.width = 320;
pipCanvas.height = 180;

const canvasElement = document.getElementById("canvas");
const canvasCtx = canvasElement.getContext("2d");
const startBtn = document.getElementById("start-btn");
const statusText = document.getElementById("status-text");
const uiLayer = document.getElementById("ui-layer");

let handLandmarker = undefined;
let runningMode = "VIDEO";
let lastVideoTime = -1;
let isCameraRunning = false;
const kirbyOverlay = document.getElementById("kirby-overlay");

// Resize canvas to match screen
function resizeCanvas() {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function createParticleSprite(r, g, b, isHighlight) {
    const canvas = document.createElement('canvas');
    const size = 16;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;

    // 점과 후광 모양 그리기
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
    gradient.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.8)`);
    gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${isHighlight ? 0.6 : 0.25})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, Math.PI * 2);
    ctx.fill();
    return canvas;
}

const particleSprites = {
    base: [
        createParticleSprite(180, 210, 255, false), // 밝은 푸른색
        createParticleSprite(90, 140, 255, false),  // 중간
        createParticleSprite(40, 90, 220, false)    // 어두운 푸른색
    ],
    highlight: [
        createParticleSprite(230, 245, 255, true),
        createParticleSprite(160, 200, 255, true),
        createParticleSprite(100, 170, 255, true)
    ]
};

// --- Particle System ---
class Particle {
    constructor() {
        this.reset();
        this.x = Math.random() * canvasElement.width;
        this.y = Math.random() * canvasElement.height;
    }

    reset() {
        this.x = Math.random() * canvasElement.width;
        this.y = Math.random() * canvasElement.height;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;

        this.size = Math.random() * 1.0 + 0.5;

        // 각 파티클별로 투명도를 다르게 주어 깊이감 형성
        this.alpha = Math.random() * 0.7 + 0.3;

        // 창백한 푸른색 ~ 짙은 푸른색 스펙트럼 인덱스 부여
        const rand = Math.random();
        if (rand > 0.7) {
            this.colorIndex = 0;
        } else if (rand > 0.3) {
            this.colorIndex = 1;
        } else {
            this.colorIndex = 2;
        }

        // 최적화를 위해 문자열 색상 대신 미리 생성된 스프라이트 이미지 할당
        this.baseSprite = particleSprites.base[this.colorIndex];
        this.highlightSprite = particleSprites.highlight[this.colorIndex];

        this.currentSprite = this.baseSprite;
    }

    update(handCenter, handState) {
        let dx = 0;
        let dy = 0;
        let dist = 1; // avoid division by zero

        if (handCenter) {
            dx = this.x - handCenter.x;
            dy = this.y - handCenter.y;
            dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        }

        let isAffected = false;

        if (handCenter) {
            // 거리에 따른 영향력(Falloff) 계산: 거리가 멀어질수록 힘이 부드럽게 감소
            // 반경 1200px까지 점진적으로 영향을 주고 그 이상은 무시
            const maxInfluenceRadius = 1200;

            if (dist < maxInfluenceRadius) {
                // 1(중심)에서 0(가장자리)으로 자연스럽게 줄어드는 곡선형 영향력 지수
                // Math.pow를 사용하여 경계선이 뚜렷하지 않고 부드럽게 풀리도록 설정
                let influenceRatio = Math.pow(1 - (dist / maxInfluenceRadius), 2);

                if (handState === 'gather') {
                    const gatherForce = (2500 / (dist + 20)) * influenceRatio;
                    this.vx -= (dx / dist) * gatherForce;
                    this.vy -= (dy / dist) * gatherForce;

                    const swirlForce = 0.8 * influenceRatio;
                    this.vx += (dy / dist) * swirlForce;
                    this.vy -= (dx / dist) * swirlForce;

                    const friction = dist < 60 ? 0.75 : 0.92;
                    this.vx *= friction;
                    this.vy *= friction;

                    // 영향력에 따라 밝은 빛으로 섞임
                    if (influenceRatio > 0.3) {
                        this.currentSprite = this.highlightSprite;
                        isAffected = true;
                    }
                } else if (handState === 'scatter') {
                    const scatterForce = (1000 / (dist + 40)) * influenceRatio;
                    const pushX = (dx / dist) * scatterForce;
                    const pushY = (dy / dist) * scatterForce;

                    const swirlX = (dy / dist) * (scatterForce * 0.4);
                    const swirlY = -(dx / dist) * (scatterForce * 0.4);

                    this.vx += pushX + swirlX;
                    this.vy += pushY + swirlY;

                    this.vx *= 0.92;
                    this.vy *= 0.92;

                    // 중심부일수록 눈부신 색상
                    if (influenceRatio > 0.2) {
                        this.currentSprite = this.highlightSprite;
                        isAffected = true;
                    }
                }
            }
        }

        // 아주 미약한 영향만 받거나 범위를 벗어난 파티클들
        if (!isAffected) {
            const cx = canvasElement.width / 2;
            const cy = canvasElement.height / 2;
            const dCenterX = cx - this.x;
            const dCenterY = cy - this.y;
            const dCenter = Math.max(Math.sqrt(dCenterX * dCenterX + dCenterY * dCenterY), 1);

            if (dCenter > 80) {
                const centerPull = 0.08;
                this.vx += (dCenterX / dCenter) * centerPull;
                this.vy += (dCenterY / dCenter) * centerPull;
            }

            this.vx += (Math.random() - 0.5) * 0.1;
            this.vy += (Math.random() - 0.5) * 0.1;

            const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

            this.vx *= 0.97;
            this.vy *= 0.97;

            if (speed > 4.0) {
                this.vx *= 0.85;
                this.vy *= 0.85;
            } else if (speed > 1.5) {
                this.vx = (this.vx / speed) * 1.5;
                this.vy = (this.vy / speed) * 1.5;
            }

            this.currentSprite = this.baseSprite;
        }

        this.x += this.vx;
        this.y += this.vy;

        // Bounce horizontally and vertically
        if (this.x < 0) { this.x = 0; this.vx *= -1; }
        if (this.x > canvasElement.width) { this.x = canvasElement.width; this.vx *= -1; }
        if (this.y < 0) { this.y = 0; this.vy *= -1; }
        if (this.y > canvasElement.height) { this.y = canvasElement.height; this.vy *= -1; }
    }

    draw(ctx) {
        let drawSize = this.size * 5;

        ctx.globalAlpha = this.alpha;
        ctx.drawImage(this.currentSprite, (this.x - drawSize / 2) | 0, (this.y - drawSize / 2) | 0, drawSize, drawSize);
    }
}

// Instantiate particles
const particles = [];
const PARTICLE_COUNT = 4500;
for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
}

// --- MediaPipe Hand Tracking Initialization ---
async function initializeHandLandmarker() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: runningMode,
            numHands: 1
        });

        statusText.innerText = "커비 준비 완료!";
        startBtn.disabled = false;

    } catch (error) {
        console.error(error);
        statusText.innerText = "로딩 실패: " + error.message;
    }
}

initializeHandLandmarker();

function enableCam() {
    if (!handLandmarker) return;

    isCameraRunning = true;
    uiLayer.style.display = "none";
    document.getElementById("pip-container").style.display = "block";
    document.body.style.backgroundImage = "url('source/background_02.png?v=2')";
    document.body.style.backgroundSize = "150%";
    document.body.style.backgroundPosition = "50% 50%"; // Set background to center initially

    const constraints = {
        video: { width: 1280, height: 720 }
    };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        video.srcObject = stream;
        pipVideo.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });
}

startBtn.addEventListener("click", enableCam);

function computeCoverScaleAndOffset() {
    if (!video.videoWidth) return { scale: 1, offsetX: 0, offsetY: 0 };

    const videoAspect = video.videoWidth / video.videoHeight;
    const screenAspect = canvasElement.width / canvasElement.height;

    let scale, offsetX, offsetY;
    if (screenAspect > videoAspect) {
        scale = canvasElement.width / video.videoWidth;
        offsetX = 0;
        offsetY = (canvasElement.height - video.videoHeight * scale) / 2;
    } else {
        scale = canvasElement.height / video.videoHeight;
        offsetX = (canvasElement.width - video.videoWidth * scale) / 2;
        offsetY = 0;
    }
    return { scale, offsetX, offsetY };
}

let currentHandState = 'idle';
let currentHandCenter = null;
let centerHistory = [];
let previousHandState = 'idle';
let blastIntensity = 0;
let blastCenter = null;
let bgOffsetX = 50;
let bgOffsetY = 50; // Change default Y offset to 50% for center alignment
let kirbyScale = 1.0;

async function predictWebcam() {
    let startTimeMs = performance.now();

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, startTimeMs);

        pipCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);

        if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];

            pipCtx.strokeStyle = "rgba(0, 242, 254, 0.8)";
            pipCtx.lineWidth = 2.5;
            pipCtx.lineJoin = "round";
            pipCtx.lineCap = "round";

            const connections = [
                // Thumb
                [0, 1], [1, 2], [2, 3], [3, 4],
                // Index
                [0, 5], [5, 6], [6, 7], [7, 8],
                // Middle
                [5, 9], [9, 10], [10, 11], [11, 12],
                // Ring
                [9, 13], [13, 14], [14, 15], [15, 16],
                // Pinky
                [13, 17], [17, 18], [18, 19], [19, 20],
                // Palm outline
                [0, 17]
            ];

            pipCtx.beginPath();
            for (let [start, end] of connections) {
                const s = landmarks[start];
                const e = landmarks[end];
                pipCtx.moveTo(s.x * pipCanvas.width, s.y * pipCanvas.height);
                pipCtx.lineTo(e.x * pipCanvas.width, e.y * pipCanvas.height);
            }
            pipCtx.stroke();

            pipCtx.fillStyle = "#ffffff";
            for (let point of landmarks) {
                pipCtx.beginPath();
                pipCtx.arc(point.x * pipCanvas.width, point.y * pipCanvas.height, 3.5, 0, 2 * Math.PI);
                pipCtx.fill();
            }

            const getDist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

            const palmSize = getDist(landmarks[0], landmarks[9]);

            const tips = [4, 8, 12, 16, 20];
            let maxSpread = 0;

            for (let i = 0; i < tips.length; i++) {
                for (let j = i + 1; j < tips.length; j++) {
                    const dist = getDist(landmarks[tips[i]], landmarks[tips[j]]);
                    if (dist > maxSpread) maxSpread = dist;
                }
            }

            const spread = maxSpread / palmSize;


            if (spread < 0.65) {
                currentHandState = 'gather';
            } else if (spread > 1.6) {
                currentHandState = 'scatter';
            } else {
                currentHandState = 'idle';
            }

            // Map the center of the palm from normalized coords to responsive canvas screen coords
            const { scale, offsetX, offsetY } = computeCoverScaleAndOffset();
            currentHandCenter = {
                x: (landmarks[9].x * video.videoWidth) * scale + offsetX,
                y: (landmarks[9].y * video.videoHeight) * scale + offsetY
            };

            centerHistory.push({ x: currentHandCenter.x, y: currentHandCenter.y, time: startTimeMs });
            // Maintain up to 2 seconds of history to save memory
            while (centerHistory.length > 0 && startTimeMs - centerHistory[0].time > 2000) {
                centerHistory.shift();
            }
        } else {

            currentHandState = 'idle';
            currentHandCenter = null;
            centerHistory.length = 0;
        }

        if (currentHandState === 'scatter' && previousHandState !== 'scatter' && currentHandCenter) {
            blastIntensity = 1.0;
            blastCenter = { x: currentHandCenter.x, y: currentHandCenter.y };
        }
        previousHandState = currentHandState;
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // 산란 시 배경에 강하게 퍼지는 폭발(블룸) 효과
    if (blastIntensity > 0 && blastCenter) {
        canvasCtx.globalCompositeOperation = "lighter";
        const radius = 2000 * (1 - blastIntensity) + 300;

        const gradient = canvasCtx.createRadialGradient(blastCenter.x, blastCenter.y, 0, blastCenter.x, blastCenter.y, radius);
        gradient.addColorStop(0, `rgba(200, 255, 255, ${blastIntensity * 0.4})`);
        gradient.addColorStop(0.3, `rgba(100, 255, 200, ${blastIntensity * 0.15})`);
        gradient.addColorStop(1, `rgba(0, 0, 0, 0)`);

        canvasCtx.fillStyle = gradient;
        canvasCtx.beginPath();
        canvasCtx.arc(blastCenter.x, blastCenter.y, radius, 0, Math.PI * 2);
        canvasCtx.fill();

        blastIntensity *= 0.88;
        if (blastIntensity < 0.01) blastIntensity = 0;
        canvasCtx.globalCompositeOperation = "source-over";
    }

    canvasCtx.globalCompositeOperation = "lighter";

    for (let p of particles) {
        p.update(currentHandCenter, currentHandState);
        p.draw(canvasCtx);
    }

    // 다른 렌더링에 영향 가지 않도록 기본값으로 복원
    canvasCtx.globalCompositeOperation = "source-over";
    canvasCtx.globalAlpha = 1.0;

    // 움직이는 커비 이미지 (GIF 애니메이션을 위해 img 태그 사용)
    if (currentHandCenter) {
        let kirbyPos = currentHandCenter;

        // gather 상태일 때 커비 사이즈 점진적으로 40% 확대
        if (currentHandState === 'gather') {
            kirbyScale += (1.4 - kirbyScale) * 0.15;
        } else {
            kirbyScale += (1.0 - kirbyScale) * 0.15;
        }

        // 배경 서서히 이동 (Parallax Effect)
        const centerX = canvasElement.width / 2;
        const centerY = canvasElement.height / 2;

        // 반전된 x값으로 배경 이동 계산 (거울모드 보정)
        const diffX = kirbyPos.x - centerX;
        const diffY = kirbyPos.y - centerY;

        // 배경 2배 추가 증가 & 중앙 정렬(50) 기준
        const targetBgX = 50 + (diffX / centerX) * 67.5;
        const targetBgY = 50 + (diffY / centerY) * 45;

        bgOffsetX += (targetBgX - bgOffsetX) * 0.1;
        bgOffsetY += (targetBgY - bgOffsetY) * 0.1;
        document.body.style.backgroundPosition = `${bgOffsetX}% ${bgOffsetY}%`;

        kirbyOverlay.style.display = 'block';
        kirbyOverlay.style.left = (canvasElement.width - kirbyPos.x) + 'px';
        kirbyOverlay.style.top = kirbyPos.y + 'px';
        kirbyOverlay.style.transform = `translate(-50%, -50%) scaleX(-1) scale(${kirbyScale})`;

        // gather 상태일 때 kirby_02.gif, 아닐 때 kirby_01.png
        const targetSrc = (currentHandState === 'gather') ? 'source/kirby_02.gif' : 'source/kirby_01.png';
        if (!kirbyOverlay.src.endsWith(targetSrc)) {
            kirbyOverlay.src = targetSrc;
        }
    } else {
        kirbyOverlay.style.display = 'none';
    }

    if (isCameraRunning) {
        window.requestAnimationFrame(predictWebcam);
    }
}
