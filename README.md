# Gym Log

모바일에서 편하게 운동을 기록하는 개인용 웹 앱입니다. React + TypeScript + Vite, Node.js API, Neon PostgreSQL과 Neon Auth를 사용합니다.

## 실행

Node.js 24 이상이 필요합니다. `nvm use`로 프로젝트 버전을 맞출 수 있습니다.

```sh
npm ci
npm run dev
```

기본 주소는 http://localhost:5173 입니다. 하나의 Node 서버가 React 개발 화면과 `/api`를 함께 제공합니다. 이메일과 비밀번호로 회원가입한 뒤 로그인하면 같은 계정의 기록을 휴대폰과 PC에서 사용할 수 있습니다.

현재 작업 환경에는 `.env.local` 설정이 준비돼 있습니다. 새 환경에서는 `.env.example`을 참고해 다음 서버 환경 변수를 구성하세요. 기존 `.env.local`은 덮어쓰지 마세요.

- `DATABASE_URL`: Neon PostgreSQL 연결 문자열
- `NEON_AUTH_BASE_URL`: Neon Auth의 인증 URL
- `NEON_AUTH_COOKIE_SECRET`: 32자 이상의 무작위 쿠키 서명 비밀값
- `APP_ORIGIN`: 브라우저에서 접속하는 정확한 사이트 주소
- `PORT`: 서버 포트, 기본 5173

쿠키 비밀값 생성 예시:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

이 환경 변수는 서버 전용입니다. `VITE_` 접두사를 붙이거나 클라이언트 코드에 포함하지 마세요. `.env.local`은 Git에서 제외됩니다.

## 기능

- **대시보드:** 이번 주 운동 일수, 총 볼륨, 누적 기록, 날짜별 주간 캘린더
- **운동 기록:** 날짜·시간·메모와 종목별 세트·무게·횟수 저장, 수정·삭제, 상세 조회
- **기록 검색:** 등·이두·가슴·삼두·어깨·하체, 월·날짜, 운동 이름으로 검색
- **나의 루틴:** 기본 루틴 3개, 직접 프리셋 만들기·수정·삭제, 기록을 루틴으로 저장
- **로그인과 동기화:** 계정별 기록 분리, 저장 완료 후 반영, 화면을 다시 열거나 포커스할 때 및 열려 있는 화면에서 60초마다 최신 기록 확인
- **이전 기록 가져오기:** 브라우저에 남아 있는 예전 기록을 현재 계정에 추가. 서버 기록은 유지하며, 같은 ID의 내용이 다르면 별도 사본으로 보존
- **백업:** 현재 기록을 JSON 파일로 내보내고, 검증·확인을 거쳐 계정의 기록과 루틴을 백업으로 교체

운동 중 작성하는 내용은 저장 버튼을 누른 뒤 서버 저장이 성공해야 보관됩니다. 저장 실패 시 작성 화면을 유지하며, 연결이 끊겼을 때 브라우저 저장으로 자동 전환하지 않습니다. 편집 중에는 자동 새로고침을 멈추고, 다른 기기의 변경과 충돌하면 최신 기록을 불러와 안내합니다.

로그인 전 브라우저에 저장했던 원본은 가져오기 후에도 삭제하지 않습니다. 가져오기 완료 표시는 계정별로 남기므로 같은 원본을 반복해서 가져오지 않습니다. 파일 백업 복원은 추가가 아니라 **현재 계정 전체 교체**이며 다른 기기에도 반영됩니다.

## 데이터 구조와 API

[Neon gym-log 프로젝트](https://console.neon.tech/app/projects/cool-mountain-36330352)는 싱가포르 리전, PostgreSQL 18, `main` 브랜치, `gym_log` 데이터베이스를 사용합니다. `db/neon.json`에 식별자를 기록했습니다.

- `user_workspaces`: 사용자 ID, 데이터 버전과 갱신 시각
- `workouts`, `workout_exercises`, `workout_sets`: 운동 기록과 종목·세트
- `routines`, `routine_exercises`, `routine_sets`: 프리셋과 종목·세트
- `neon_auth` 스키마: Neon이 관리하는 계정과 세션

초기 마이그레이션 `001_initial.sql`과 사용자 분리 마이그레이션 `002_user_workspaces.sql`을 적용했습니다. 002는 소유자가 없는 기존 데이터가 있으면 실패하도록 되어 있습니다. 새 DB에는 파일 번호 순서대로 적용합니다.

`GET /api/data`는 로그인한 사용자의 `{ data, revision }`을 반환합니다. `PUT /api/data`는 같은 구조를 받아 검증하고 한 트랜잭션으로 저장합니다. 사용자 ID는 검증된 서버 세션에서만 결정합니다. 버전이 달라지면 409를 반환하며 기존 기록을 덮어쓰지 않습니다. 종목과 세트 순서는 `position`에 보관하고, 서로 다른 계정에서 같은 백업 ID를 사용해도 충돌하지 않습니다.

`/api/auth`는 공식 Neon Auth 서버 SDK를 통한 같은 사이트의 인증 프록시입니다. 브라우저는 DB 연결 문자열을 받지 않습니다. 변경 API는 요청 Origin도 확인합니다.

## 명령어와 검증

- `npm run dev`: API와 Vite 개발 서버, 서버 코드 자동 재시작
- `npm run typecheck`: 클라이언트·서버 타입 검사
- `npm test`: 데이터 검증, 이전 기록 병합, API 인증·Origin, 트랜잭션·충돌 단위 테스트
- `npm run build`: 타입 검사 및 프런트엔드 배포 빌드
- `npm start`: 빌드된 화면과 API를 제공하는 운영 서버
- `npm run preview`: 운영 서버와 동일한 실행 방식

실제 PostgreSQL 통합 테스트는 `TEST_DATABASE_URL`을 지정해 `node --test server/repository.test.ts`로 실행합니다. 고유한 테스트 작업공간을 만들고 정리하며 사용자 분리, 왕복 저장, 실패 시 롤백, 동시 저장 충돌을 검사합니다. 일반 `npm test`에서는 이 테스트만 건너뜁니다.

## 배포

Vercel 프로젝트는 `hwan-krs-projects/gym-log`이며 운영 주소는 https://gym-log-xi-ecru.vercel.app 입니다. Vite 빌드 결과는 CDN에서 제공하고, `/api/*`는 `api/index.ts`의 Express 함수로 전달합니다. 함수는 Neon DB와 같은 싱가포르 리전(`sin1`)에서 실행합니다.

현재 작업 폴더는 Vercel 프로젝트에 연결돼 있습니다. 변경 사항을 배포하려면 다음을 실행합니다.

```sh
npm test
vercel deploy --prod --yes --scope hwan-krs-projects
```

Vercel **Production** 환경에는 `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `APP_ORIGIN`, `NODEJS_HELPERS=0`을 등록합니다. DB 연결 문자열과 쿠키 비밀값은 Sensitive로 저장하며 로컬 환경 파일을 업로드하지 않습니다. `NODEJS_HELPERS=0`은 요청 본문을 Express에서 처리하도록 합니다. 운영 `APP_ORIGIN`과 Neon Auth trusted domains에는 동일한 HTTPS 주소를 사용합니다.

미리보기 배포에는 운영 DB 비밀값을 자동 공유하지 않습니다. 별도 미리보기 환경을 사용하려면 해당 환경의 DB·인증 설정과 도메인을 먼저 준비하세요. Git 자동 배포는 설정하지 않았으며 위 CLI 명령은 현재 작업 폴더의 내용을 배포합니다.

Vercel 이외의 Node.js 24 환경에서도 `npm run build` 후 `npm start`로 실행할 수 있습니다. 외부 접속에는 HTTPS를 사용하고 `APP_ORIGIN`을 실제 도메인으로 설정하세요. 리버스 프록시를 사용하면 `/api`를 포함한 요청 전체를 Node 서버로 전달합니다.

## 주요 파일

- `src/App.tsx`: 화면, 서버 저장, 오류·충돌 처리, 이전 기록과 백업 가져오기
- `src/components/AuthGate.tsx`, `src/lib/auth-client.ts`: 로그인과 회원가입
- `src/components/WorkoutEditor.tsx`: 운동·루틴 편집
- `src/lib/cloud.ts`: 비동기 API 호출
- `src/lib/gym.ts`, `src/lib/legacy.ts`: 데이터 검증·계산과 이전 기록 병합
- `server/index.ts`, `server/app.ts`: 서버 진입점과 API
- `server/runtime.ts`, `api/index.ts`, `vercel.json`: 공통 서버 설정과 Vercel 함수·라우팅
- `server/auth.ts`: 인증 프록시와 서버 세션 확인
- `server/repository.ts`: 사용자별 PostgreSQL 트랜잭션
- `db/migrations/`: DB 스키마 변경 이력
