# Pit Wall Command Center

F1 25 UDP 텔레메트리를 실시간 레이스 엔지니어링 대시보드로 변환하는 3계층 아키텍처입니다.

## 🚀 Download — 바로 실행 (권장)

> **Windows 유저는 .exe 하나만 다운로드하면 끝!**

1. [**최신 릴리스 다운로드 →**](../../releases/latest) 페이지에서 `.exe` 파일을 받으세요
   - `F1-PitWall-*-Setup.exe` — **설치형** (시작 메뉴 + 바탕화면 바로가기)
   - `F1-PitWall-*-portable.exe` — **포터블** (설치 없이 바로 실행)
2. 다운로드한 `.exe`를 실행합니다
3. F1 25 게임에서 **Settings → Telemetry → UDP Telemetry: On** (Port: 20777)
4. 게임을 시작하면 PitWall이 자동으로 텔레메트리를 수신합니다

> 시스템 요구사항: Windows 10/11 64-bit, F1 25

---

## Windows 단일 EXE 직접 빌드 (원클릭)

아래 스크립트를 실행하면, 백엔드 onefile EXE + 프론트 빌드 + Electron portable EXE를 한 번에 생성합니다.

```powershell
cd scripts/windows
./build_one_exe.ps1
```

또는 더블클릭용 배치 파일:

```bat
scripts\\windows\\build_one_exe.bat
```

결과물:

- `electron/dist/F1-PitWall-<version>-portable-x64.exe`

이 파일 하나만 실행하면 Electron이 내부 백엔드 EXE(`backend_dist/pitwall-backend.exe`)를 자동 기동하고 UI를 띄웁니다.
빌드 전 요구사항: Windows + Python 3.11 + Node.js 18+.

## 🏁 Quick Start — 로컬 실행 (F1 25 연동)

F1 25 게임에서 UDP 텔레메트리를 직접 수신하여 브라우저 대시보드에 실시간 표시합니다.

### 요구사항

- Python 3.11+, Node.js 18+
- F1 25 게임 (또는 테스트 시뮬레이터)

### 1단계: 백엔드 실행

```bash
# 방법 A: 스크립트 (자동 venv 생성 + 의존성 설치)
./run_server.sh

# 방법 B: 수동
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn pitwall.main:app --host 0.0.0.0 --port 8765
```

백엔드가 시작되면:
- **UDP 20777** — F1 25 텔레메트리 수신 대기
- **HTTP/WS 8765** — API + WebSocket 서버

### 2단계: 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 **http://localhost:5173** 접속 → 대시보드 UI 표시

### 3단계: F1 25 게임 설정

게임 내 **Settings → Telemetry** 에서:
- UDP Telemetry: **On**
- UDP Port: **20777**
- UDP IP: 백엔드가 실행 중인 PC의 IP (같은 PC면 `127.0.0.1`)

### 게임 없이 테스트

```bash
cd backend
python3 test_udp_sender.py           # 기본: 127.0.0.1:20777, 20Hz
python3 test_udp_sender.py --hz 10   # 10Hz로 느리게
```

이 스크립트는 22대의 차량이 5랩을 도는 모의 텔레메트리를 전송합니다.

### 포트 변경

```bash
PITWALL_UDP_PORT=20888 ./run_server.sh   # UDP 포트 변경
```

### 디버그 확인

- `http://localhost:8765/health` — 서버 상태
- `http://localhost:8765/debug` — UDP 수신 통계, WS 클라이언트 수, 세션 정보
- `http://localhost:8765/state` — 현재 전체 AppState

---

## 1) 최종 아키텍처

시스템은 다음 3개 계층으로 완전히 분리됩니다.

1. Local UDP Bridge (PC별 실행)
2. Cloud Relay Server (중앙 WebSocket 허브)
3. React Frontend (관전/분석 UI)

### 네트워크 흐름

1. F1 25 게임이 각 PC에서 UDP 20777로 텔레메트리 송출
2. Local Bridge가 UDP를 파싱하여 AppState JSON 생성
3. Local Bridge가 Cloud Relay로 `ws(s)://.../ws?role=bridge&token=...` 연결
4. Relay가 최신 상태를 메모리에 유지하고 Viewer들에게 브로드캐스트
5. React 클라이언트는 `ws(s)://.../ws?role=viewer`로 read-only 구독

### 연결/프로토콜

- Bridge -> Relay: WebSocket, JSON message
	- `{ type: "state", source, seq, sessionId, payload: AppState }`
- Viewer <- Relay: WebSocket, JSON message
	- `{ type: "state", sessionId, payload: AppState, meta }`
- Viewer <- Relay: Server-Sent Events(optional fallback)
	- `GET /events?sessionId=<id>`
- Strategy feedback: HTTP POST
	- `/api/strategy/feedback?sessionId=<id>`

### 세션 모델 (멀티 사용자)

1. Relay는 `sessionId` 단위로 상태를 분리 저장
2. Bridge는 특정 세션에 publish
3. Viewer는 동일 `sessionId`로 접속하면 같은 레이스 상태를 공유 관전
4. 기본 세션은 `public`이며 URL 파라미터 `?sessionId=...`로 즉시 전환 가능

## 2) 폴더 구조

- `local-bridge`: 로컬 UDP 수신/파싱/전송 (Node.js)
- `relay-server`: 클라우드 실시간 중계 및 피드백 학습 (Node.js + ws)
- `frontend`: React + TypeScript Pitwall UI
- `backend`: 기존 Python 엔진(로컬 실험/회귀 테스트 용도)

## 3) Local Bridge 실행

```bash
cd local-bridge
cp .env.example .env
npm install
npm start
```

### Local Bridge .env

- `UDP_HOST=0.0.0.0`
- `UDP_PORT=20777`
- `RELAY_WS_URL=wss://<relay-domain>/ws`
- `BRIDGE_ID=pc-1` (PC마다 다르게 설정)
- `BRIDGE_TOKEN=<relay와 동일한 토큰>`
- `PUBLISH_HZ=15`

## 4) Relay Server 실행

```bash
cd relay-server
cp .env.example .env
npm install
npm start
```

### Relay 인증 정책

- Bridge는 `role=bridge` + 유효 토큰이 있어야 publish 가능
- Viewer는 기본 read-only
- 토큰은 `BRIDGE_TOKENS`(콤마 구분)로 관리

### Relay 주요 API

- `GET /health`: 상태, 연결 수, 모델 통계
- `GET /state?sessionId=...`: 세션별 최신 AppState
- `GET /events?sessionId=...`: 세션별 SSE 스트림
- `POST /api/rooms/create`: 드라이버 룸 생성 + short-lived auth token 발급
- `POST /api/rooms/join`: 엔지니어/드라이버 룸 참여 + short-lived auth token 발급
- `POST /api/auth/refresh`: short-lived auth token 갱신
- `POST /api/strategy/feedback`: 사용자 피드백 수집 + 온라인 업데이트
- `GET /api/strategy/stats`: 전략 학습 통계

### 멀티플레이어 룸 워크플로우 (신규)

1. 드라이버가 `POST /api/rooms/create`로 `roomId/password/hostDriverId`를 전송
2. 응답 `authToken`으로 드라이버 클라이언트가 `/ws?role=viewer&viewerRole=driver&sessionId=...&clientId=...&auth=...` 접속
3. 엔지니어가 `POST /api/rooms/join`으로 같은 `roomId/password`로 참여
4. 엔지니어는 `command_submit` WS 메시지를 전송
5. 서버가 `driver_command`를 드라이버에게 릴레이, 드라이버는 `command_ack`로 응답

프론트엔드는 `auth` 쿼리가 존재하면 룸 인증 모드로 접속하며, `POST /api/auth/refresh`를 주기 호출해 토큰을 자동 갱신합니다.

자세한 메시지 스펙은 `relay-server/PROTOCOL.md`를 참고하세요.

### Relay 안정화 로직

1. 소스별 `seq`/`last_frame_identifier` 워터마크 관리
2. 중복 프레임 및 역전 프레임 드롭
3. 팬아웃은 `STREAM_HZ` 기반 스로틀(merge) 적용
4. 늦은 상태는 `meta.stale` 플래그로 표시

## 5) Frontend 실행

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

### Frontend .env

- `VITE_WS_RELAY_URL=wss://<relay-domain>/ws`
- `VITE_RELAY_API_BASE=https://<relay-domain>`

## 6) 성능/실시간 최적화

프론트엔드 최적화는 다음이 반영되어 있습니다.

1. WebSocket 수신 -> `requestAnimationFrame` 배치 반영
2. 컴포넌트별 cadenced state 분리(빠른/중간/안정 템포)
3. Leaderboard row 단위 memoization + FLIP 애니메이션
4. Minimap 차량 smoothing + transform 기반 비율 고정 투영

## 7) Minimap/Leaderboard 개선 사항

### Minimap

1. transform 기반 world -> screen 정규화
2. aspect ratio 고정
3. 차량 heading 기반 회전 렌더링
4. DRS 구간 표시 개선
	- `start_ratio > end_ratio` 래핑 구간 처리
	- 직선 line이 아닌 트랙 polyline 구간으로 렌더링

### Leaderboard

1. gap 모드 전환 (player/leader/interval)
2. 변화량 기반 색상/라벨
3. 순위 변동 애니메이션(FLIP)

## 8) 전략 엔진 파인튜닝(실사용 피드백 학습)

Relay 서버가 사용자 피드백을 수집하고, 온라인 업데이트를 수행합니다.

1. UI에서 "추천 적중/보통/실패" 버튼 클릭
2. `/api/strategy/feedback`으로 action/reward/context 전송
3. Relay의 `StrategyTrainer`가 액션별 가중치 업데이트
4. 피드백 NDJSON 로그와 모델 파일을 주기 저장

즉, 단순 로깅이 아니라 운영 중 incremental learning이 가능합니다.

## 9) 배포 전략

### 빠른 결론 (영구 배포 파이프라인)

이 저장소는 아래 3개 경로를 모두 지원하도록 구성되었습니다.

1. GitHub Pages: 정적 프론트 자동 배포
2. Vercel: 정적 프론트 프로덕션/프리뷰 배포
3. Render: Relay(Node WebSocket) + 정적 프론트 배포

추가된 파일:

- [.github/workflows/deploy-frontend.yml](.github/workflows/deploy-frontend.yml)
- [.github/workflows/deploy-vercel.yml](.github/workflows/deploy-vercel.yml)
- [.github/workflows/deploy-render.yml](.github/workflows/deploy-render.yml)
- [render.yaml](render.yaml)
- [frontend/vercel.json](frontend/vercel.json)
- [frontend/.env.production.example](frontend/.env.production.example)
- [relay-server/.env.production.example](relay-server/.env.production.example)

### Frontend (GitHub Pages 빠른 공개)

레포에 [.github/workflows/deploy-frontend.yml](.github/workflows/deploy-frontend.yml)을 추가했습니다.

1. GitHub Repository Settings -> Pages 에서 Source 를 GitHub Actions 로 설정
2. `main` 브랜치에 푸시하거나 Actions 에서 `Deploy Frontend` 수동 실행
3. 기본 공개 페이지는 `VITE_DEFAULT_DEMO_MODE=monaco` 로 빌드되어, Relay 없이도 동작 확인 가능
4. Relay 실운영 연결이 필요하면 Repository Secrets/Variables 또는 workflow env 에 아래 값을 추가
	- `VITE_WS_RELAY_URL`
	- `VITE_RELAY_API_BASE`

최소 승인 절차:

1. Repository -> Settings -> Pages -> Build and deployment -> Source: GitHub Actions
2. Repository -> Settings -> Variables -> Actions에 다음 값 등록
	- `VITE_WS_RELAY_URL`
	- `VITE_RELAY_API_BASE`
	- `VITE_SESSION_ID` (선택)
	- `VITE_DEFAULT_DEMO_MODE` (선택)
3. Actions에서 `Deploy Frontend` 실행 또는 `main` push

### Frontend (정적 호스팅)

추천: Vercel / Netlify / Cloudflare Pages

1. `frontend` 디렉토리 연결
2. Build command: `npm run build`
3. Output directory: `dist`
4. 환경변수 설정
	- `VITE_WS_RELAY_URL`
	- `VITE_RELAY_API_BASE`

#### Vercel (권장 자동화)

워크플로: [.github/workflows/deploy-vercel.yml](.github/workflows/deploy-vercel.yml)

필수 Secrets:

1. `VERCEL_TOKEN`
2. `VERCEL_ORG_ID`
3. `VERCEL_PROJECT_ID`

실행:

1. Actions -> `Deploy Frontend to Vercel` -> Run workflow
2. `environment`를 `preview` 또는 `production` 선택

### Relay (무료 Node 호스팅)

추천: Render Web Service / Railway

1. `relay-server` 디렉토리 배포
2. Start command: `npm start`
3. 환경변수 설정
	- `PORT`
	- `BRIDGE_TOKENS`
	- `STREAM_HZ`
	- `CORS_ORIGIN`
	- `DEFAULT_SESSION_ID`
	- `MODEL_PATH`
	- `FEEDBACK_LOG_PATH`
4. WebSocket path: `/ws`
5. SSE path: `/events`

#### Render (권장 자동화)

IaC 파일: [render.yaml](render.yaml)

워크플로: [.github/workflows/deploy-render.yml](.github/workflows/deploy-render.yml)

필수 Secrets:

1. `RENDER_RELAY_DEPLOY_HOOK_URL`
2. `RENDER_FRONTEND_DEPLOY_HOOK_URL`

최소 승인 절차:

1. Render에서 relay(web) + frontend(static) 서비스 생성
2. 각 서비스의 Deploy Hook URL을 GitHub Secrets로 등록
3. Actions -> `Trigger Render Deploy` 실행 (`relay`, `frontend`, `both` 선택)

### Bridge (각 PC)

1. `local-bridge` 폴더 배포/복사
2. `.env`에서 `BRIDGE_ID` 고유값 설정
3. `RELAY_WS_URL`, `BRIDGE_TOKEN` 설정
4. 게임 실행 후 bridge 시작

## 10) 운영 이슈와 대응

1. 지연(latency)
	- Bridge publish 주기 제한(기본 15Hz)
	- 프론트 rAF 배치로 렌더 폭주 방지

2. 데이터 손실
	- Relay는 최신 상태 스냅샷을 항상 유지
	- Viewer 재접속 시 즉시 최신 상태 전달

3. 서버 sleep(무료 플랜)
	- 첫 접속 지연 대비 UI 상태 표시/재시도
	- 필요 시 업타임 핑 또는 유료 always-on 전환

4. 인증/오남용
	- Bridge 토큰 필수
	- Viewer read-only 강제

## 11) 확장 포인트

1. Bridge 다중 입력 머지(복수 드라이버 세션)
2. Relay 샤딩(방/세션 단위)
3. 전략 학습 모델 고도화(컨텍스트 밴딧 -> 오프라인 재학습 파이프라인)
4. 관전 URL/권한(초대 코드, JWT) 추가
5. Observability (OpenTelemetry + Prometheus/Grafana)
