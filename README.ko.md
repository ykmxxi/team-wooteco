**한국어** | [English](README.md)

# hackathon-starter

AI Agent 해커톤 문서이자, [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript)와 [Moru](https://github.com/moru-ai/moru) 클라우드 샌드박스를 활용한 AI 에이전트 스타터 레포입니다.

## 결과물

목표는 간단합니다. 누구나 접속해서 Claude 에이전트와 대화할 수 있는 **웹 앱**을 만들어 주세요.

이 레포에 채팅 UI, 파일 뷰어, Claude Agent SDK를 실행할 샌드박스를 설정해놓았어요. 처음부터 직접 만들고 싶으신 분은 그렇게 하셔도 되고, 빠르게 Claude Agent SDK 로직만 수정하실 분은 이 레포를 Fork해서 작업/배포하신 뒤 URL을 제출하면 됩니다.

## 타임테이블

| 시간 | 내용 |
|------|------|
| 12:00 – 12:30 | 체크인 및 룰 소개 |
| 12:30 – 16:00 | Happy hacking |
| 16:00 – 16:45 | 데모 |
| 16:45 – 17:00 | 심사 및 시상 |
| 17:00 – 17:45 | 네트워킹 |
| 17:45 – 18:00 | 뒷정리 |

## 제출 방법

[Seoul AI Builders Discord](https://discord.gg/g5M7rqfEPY)의 `#hackathon` 채널에 접속 가능한 URL과 함께 제출해 주세요.

> "Team XYZ 해커톤 제출" 또는 "오민석 해커톤 제출"

**URL은 16:00 전에 언제든 제출할 수 있어요. 마지막에 제출한 팀이 먼저 데모합니다.**

직접 레포를 만들어서 작업하시는 분은 바로 디스코드에 제출하시면 됩니다! 이 스타터 레포를 사용하시는 분은 아래 사전 준비를 따라주세요.

## 평가 기준

1. **URL 접속 가능 여부** — 배포가 되어 있어야 합니다
2. **창의성** — 어떤 에이전트를 만들었는지, 얼마나 재밌는지
3. **커뮤니티 투표** — 참가자들이 직접 투표합니다
4. **보너스** — Moru 샌드박스를 활용하면 가산점!

## 사전 준비 (스타터 레포 사용 시)

해커톤 시작 전에 미리 준비해 주세요:

1. **Moru API 키** — [Moru](https://github.com/moru-ai/moru)는 Claude Agent SDK를 클라우드에서 실행하기 위한 샌드박스입니다. 각 에이전트를 격리된 환경에서 돌릴 수 있어요. [moru.io/dashboard](https://moru.io/dashboard?tab=keys)에서 API 키를 발급해주세요. 무료입니다!

> Claude Agent SDK를 웹에 배포하려면 Moru가 아니더라도 어떤 형태로든 샌드박스가 필요합니다. 자세한 내용은 [호스팅 문서](https://platform.claude.com/docs/ko/agent-sdk/hosting)와 [보안 배포 문서](https://platform.claude.com/docs/ko/agent-sdk/secure-deployment)를 참고하세요.

2. **Anthropic API 키** — 아직 없다면 [platform.claude.com](https://platform.claude.com/)에서 발급해주세요. 로컬 Claude의 `.credentials.json`을 사용할 수도 있지만 (Claude Code에 "find my credentials.json" 이라고 하면 찾아줍니다), 보안상 API 키를 권장합니다. API 키 비용은 사비로 부담하셔야 합니다.

3. **Vercel 계정** — [vercel.com](https://vercel.com)에서 배포용 계정을 만들어 주세요. 무료 플랜으로 충분합니다.

4. **PostgreSQL 데이터베이스** — [Neon](https://neon.tech) 또는 [Supabase](https://supabase.com)에서 무료 계정을 만들어 주세요. 둘 다 넉넉한 무료 플랜이 있고, 카드 등록 필요 없습니다.

Vercel, Neon, Supabase 모두 꽤나 성숙한 서비스라 Docs가 잘 되어있고, ChatGPT나 Claude에게 물어보면 설정하는 방법 단계별로 잘 알려줍니다!

## 배포 (Vercel) — 먼저 배포하세요!

> 시간이 짧습니다. **로직보다 배포를 먼저 하세요.** 일단 배포해서 URL을 확보한 다음, 에이전트 로직을 수정하는 게 훨씬 안전합니다.

이 레포는 **pnpm**을 사용합니다. 설치가 안 되어 있다면 코딩 에이전트에게 "install pnpm" 이라고 하면 알아서 해줍니다.

### 1. Fork & clone

```bash
git clone https://github.com/moru-ai/hackathon-starter.git
cd hackathon-starter
pnpm install
```

### 2. 템플릿 alias 변경

템플릿 alias는 Moru 전체에서 유일해야 합니다. 팀 이름 등으로 바꿔주세요. **두 파일 모두** 수정해야 합니다:

- `agent/template.ts` — `templateAlias` 변수
- `lib/moru.ts` — `TEMPLATE_NAME` 상수

예: `moru-hackathon-agent` → `team-xyz-agent`

### 3. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일에 아래 값을 채워주세요:

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 (Neon/Supabase에서 복사) |
| `MORU_API_KEY` | Moru API 키 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `BASE_URL` | 배포 URL (예: `https://your-app.vercel.app`) |

### 4. DB 스키마 push

```bash
pnpm db:push
```

> 확인: "Your database is now in sync with your Prisma schema" 메시지가 나오면 성공입니다.

### 5. 에이전트 템플릿 빌드

```bash
pnpm build:template
```

Moru에 에이전트 Docker 이미지를 빌드합니다. 로컬에 Docker가 필요 없어요 — Moru가 원격으로 빌드합니다.

> 확인: 빌드가 끝나면 template ID와 alias가 출력됩니다.

### 6. Vercel에 배포

```bash
npm i -g vercel
vercel login
vercel --prod -y
```

> 확인: `vercel whoami`로 로그인 상태를 확인할 수 있어요.

환경 변수도 Vercel에 추가해주세요:

```bash
printf 'your-database-url' | vercel env add DATABASE_URL production
printf 'your-moru-api-key' | vercel env add MORU_API_KEY production
printf 'your-anthropic-api-key' | vercel env add ANTHROPIC_API_KEY production
printf 'https://your-app.vercel.app' | vercel env add BASE_URL production
```

환경 변수 추가 후 다시 배포:

```bash
vercel --prod -y
```

> 확인: 배포된 URL을 브라우저에서 열어보세요. 채팅 UI가 보이면 성공! 메시지를 보내서 에이전트가 응답하는지까지 확인하면 완벽합니다.

이제 URL이 생겼습니다! 여기서부터 에이전트 로직을 수정하면 됩니다.

## 로컬 개발

배포 후에 로컬에서 개발하고 싶다면 아래를 준비해주세요:

- **Node.js 20+** & **pnpm** — `npm install -g pnpm`
- **Moru CLI** — `curl -fsSL https://moru.io/cli/install.sh | bash && moru auth login`
- **ngrok** — 로컬 서버를 외부에서 접근할 수 있게 해줍니다. [ngrok.com](https://ngrok.com)에서 설치

### 1. ngrok 실행

```bash
ngrok http 3000
```

나온 URL (예: `https://abc123.ngrok-free.app`)을 `.env`의 `BASE_URL`에 넣어주세요.

### 2. 개발 서버 실행

```bash
pnpm dev
```

[http://localhost:3000](http://localhost:3000)에서 확인하세요.

---

막히는 게 있으면 [Discord `#hackathon` 채널](https://discord.gg/g5M7rqfEPY)에서 편하게 질문해 주세요!
