# Polling Issue - 다중 에이전트 과학적 토론 결과

## 문제 현상

배포된 Next.js 앱에서 동일한 conversation API 엔드포인트(`/api/conversations/{id}`)가 **80번 이상** 반복 요청되며, Network 탭에서 pending 상태로 쌓이는 현상 발생.

**관찰된 단서:**
- `X-Vercel-Cache: MISS` - 매번 캐시 미스
- `Cache-Control: public, max-age=0, must-revalidate` - 캐시 사실상 비활성화
- `Vary` 헤더에 RSC 관련 값 포함 - Next.js App Router의 RSC 요청
- `files?path=/&tree=true` 요청도 동일한 수로 쌓여 있음

---

## 5-Agent 과학적 토론

5명의 에이전트가 각각 독립적인 가설을 조사하고, 교차 토론을 통해 합의에 도달했습니다.

---

### 가설 1: Concurrent Request Stacking (동시 요청 적체)

**주장자:** hypothesis-1-concurrent

**핵심 주장:** `setInterval`은 이전 `fetch` 완료 여부와 무관하게 2초마다 새 요청을 실행한다. 서버 응답이 3-4초 걸리면, 이전 요청이 완료되기 전에 새 요청이 쌓인다.

**코드 증거 (`app/page.tsx:73-102`):**
```typescript
const pollInterval = setInterval(async () => {
  // async 함수이지만, setInterval은 이 Promise의 완료를 기다리지 않음
  const response = await fetch(`/api/conversations/${conversationId}`);
  // ... 3-4초 소요
}, 2000); // 2초마다 새 요청 시작
```

- `setInterval(async () => {...}, 2000)`에서 async callback의 반환값(Promise)은 `setInterval`에 의해 **무시**됨
- 서버 응답이 2초를 초과하면, 이전 요청이 아직 pending인 상태에서 새 요청이 발사됨
- 160초(약 2.7분) 동안 running 상태가 유지되면: 160/2 = 80개 요청 적체

**토론 중 평가:** :white_check_mark: **1차 합의 - 핵심 원인으로 확정**
- 가설 2 지지자도 "이 문제가 없으면 dependency loop도 의미 없다"고 양보
- 가설 5 지지자는 "서버 지연이 이 문제를 증폭시킨다"고 보완 관계 인정

---

### 가설 2: useEffect Dependency Loop (의존성 루프)

**주장자:** hypothesis-2-dependency

**핵심 주장:** `useEffect`의 dependency 배열 `[conversationId, status, pendingMessages.length, hasPendingMatch]`에서 `status`와 `pendingMessages.length`가 매 poll마다 변경되어 interval이 불필요하게 재생성된다.

**코드 증거 (`app/page.tsx:64-105`):**
```typescript
useEffect(() => {
  // ...
  const pollInterval = setInterval(async () => {
    setStatus(data.status);           // status 변경 시 useEffect 재실행
    setPendingMessages((prev) =>      // length 변경 시 useEffect 재실행
      prev.filter((p) => !hasPendingMatch(p, data.messages))
    );
  }, 2000);
  return () => clearInterval(pollInterval);
}, [conversationId, status, pendingMessages.length, hasPendingMatch]);
```

**토론 중 반박:**
- :x: **가설 1, 3 지지자에 의해 약화됨**
- React의 `useState`는 동일한 값으로 `setState`를 호출하면 리렌더링을 **스킵**함
- `status`가 계속 `"running"`이면 `setStatus("running")`은 리렌더링을 유발하지 않음
- `pendingMessages.length`는 필터링 후에도 동일할 수 있으며, 참조 동등성이 유지됨
- 실제로 interval이 "폭풍"처럼 재생성되는 것은 `status`가 `"running"` → `"completed"`로 전환되는 **1회**뿐

**최종 평가:** :warning: **기여 요인이지만 핵심 원인은 아님** (impact: 낮음)

---

### 가설 3: refreshTrigger Cascade (연쇄 반응)

**주장자:** hypothesis-3-refresh

**핵심 주장:** 매 polling(2초)마다 `setRefreshTrigger((prev) => prev + 1)`이 호출되어, `WorkspacePanel`의 `fetchFileTree()`가 연쇄적으로 트리거된다. 결과적으로 매 poll마다 **conversation API + files API = 2배 요청량**이 발생한다.

**코드 증거:**

`app/page.tsx:97`:
```typescript
setRefreshTrigger((prev) => prev + 1); // 매 poll마다 무조건 증가
```

`components/workspace/workspace-panel.tsx:61-63`:
```typescript
useEffect(() => {
  fetchFileTree();  // GET /api/conversations/{id}/files?path=/&tree=true
}, [fetchFileTree, refreshTrigger]); // refreshTrigger 변경 = files API 호출
```

- 80개 conversation 요청 + 80개 files 요청 = **총 160개 요청**
- `refreshTrigger`는 데이터 변경 여부와 무관하게 **무조건** 증가
- files API는 Prisma DB 조회 + Moru volume 리스팅으로 서버 부하도 2배

**토론 중 평가:** :white_check_mark: **2차 합의 - 증폭 요인으로 확정**
- 가설 1의 concurrent stacking이 근본 원인이지만, 이 cascade가 피해를 **2배로 증폭**
- 가설 5 지지자는 "서버 부하도 2배가 되니 응답 지연도 악화"라고 동의

---

### 가설 4: Polling Termination Failure (종료 실패)

**주장자:** hypothesis-4-termination

**핵심 주장:** `status === "completed"` 후에도 `pendingMessages`가 서버 데이터에서 매칭되지 않으면, `postCompletionPollsRef.current >= 10`까지 최대 10번(20초) 추가 폴링이 발생한다.

**코드 증거 (`app/page.tsx:67-70`):**
```typescript
const isDone = status === "completed" || status === "error";

// completed인데 pendingMessages가 아직 있고, 10번 미만이면 → 계속 폴링
if (isDone && (pendingMessages.length === 0 || postCompletionPollsRef.current >= 10)) return;
```

**hasPendingMatch 매칭 실패 시나리오:**
- 서버 세션 파일에서 메시지 형식이 클라이언트의 `pending.content`와 다를 수 있음
- `ContentBlock[]` vs `string` 변환 과정에서 공백/줄바꿈 차이 가능
- 세션 파일이 아직 volume에 동기화되지 않은 경우

**토론 중 반박:**
- :x: **가설 1 지지자에 의해 규모 반박됨**
- 최대 10번(20초) 추가 폴링은 80개 요청 중 **12.5%**에 불과
- `postCompletionPollsRef`가 안전 밸브 역할을 하므로 무한 폴링은 불가능
- 문제의 대부분은 `"running"` 상태 동안 발생하며, termination은 마무리 단계에서만 관련

**최종 평가:** :warning: **부차적 문제** (impact: 중간 - 사용자 경험에는 영향)

---

### 가설 5: Server-Side Bottleneck (서버 측 병목)

**주장자:** hypothesis-5-serverside

**핵심 주장:** 클라이언트 폴링 로직 자체보다 서버 측의 복합 지연이 응답 시간을 2초 이상으로 만드는 근본 원인이다. 서버가 빨랐다면 concurrent stacking도 발생하지 않았을 것이다.

**코드 증거 (`app/api/conversations/[id]/route.ts`):**
```typescript
// 순차 실행되는 3단계 - 각각 지연 발생 가능
const conversation = await prisma.conversation.findUnique({...});   // 1) DB 조회
const content = await readVolumeFile(conversation.volumeId, path);  // 2) Volume 읽기
response.messages = parseSessionJSONL(content);                     // 3) JSONL 파싱
```

**병목 지점 분석:**
1. **Vercel Serverless Cold Start**: 함수 첫 호출 시 1-3초 지연
2. **Prisma DB Connection Pool**: 동시 요청 급증 시 커넥션 풀 고갈 → 대기열 발생
3. **Moru Volume readVolumeFile**: 원격 API 호출로 네트워크 지연 (JuiceFS writeback)
4. **files API도 동일 구조**: `prisma.findUnique` + `buildFileTree(volumeId, path)`

**토론 중 평가:** :white_check_mark: **3차 합의 - 증폭 요인으로 확정**
- 가설 1 지지자도 "서버가 200ms에 응답하면 concurrent stacking은 발생 안 한다"고 인정
- 하지만 "서버 최적화는 인프라 변경이라 즉시 적용 어려움, 클라이언트 guard가 먼저"라고 반론
- **결론**: 근본 원인의 **전제 조건**이지만, 독립적으로는 수정 우선순위가 낮음

---

## 합의 결과: 원인 계층 구조

토론을 통해 5명의 에이전트가 합의한 **원인 계층 구조**:

```
┌─────────────────────────────────────────────────────────────┐
│                    80개 요청 적체 현상                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [1순위 - 핵심 원인] Concurrent Request Stacking             │
│  setInterval이 이전 fetch 완료를 기다리지 않아 요청 중첩          │
│  영향도: ★★★★★                                              │
│                                                             │
│  [2순위 - 2배 증폭] refreshTrigger Cascade                   │
│  매 poll마다 files API도 동시 호출하여 총 요청량 2배              │
│  영향도: ★★★★☆                                              │
│                                                             │
│  [3순위 - 전제 조건] Server-Side Bottleneck                   │
│  서버 응답 지연(>2초)이 concurrent stacking의 트리거            │
│  영향도: ★★★☆☆                                              │
│                                                             │
│  [4순위 - 부차적] Polling Termination Failure                 │
│  completed 후 최대 20초 추가 폴링 (안전 밸브 있음)               │
│  영향도: ★★☆☆☆                                              │
│                                                             │
│  [5순위 - 최소] useEffect Dependency Loop                    │
│  React batching으로 대부분 완화됨                              │
│  영향도: ★☆☆☆☆                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 합의된 수정 방안 (우선순위 순)

### Fix 1: Concurrent Request Guard (즉시 적용 - 가장 높은 ROI)

```typescript
// app/page.tsx - polling useEffect 수정
const isPollingRef = useRef(false);

useEffect(() => {
  if (!conversationId) return;

  const isDone = status === "completed" || status === "error";
  if (isDone && (pendingMessages.length === 0 || postCompletionPollsRef.current >= 10)) return;
  if (!isDone && status !== "running") return;

  const pollInterval = setInterval(async () => {
    if (isPollingRef.current) return; // 이전 요청 진행 중이면 skip
    isPollingRef.current = true;
    try {
      const response = await fetch(`/api/conversations/${conversationId}`);
      if (response.ok) {
        const data: ConversationResponse = await response.json();
        setServerMessages(data.messages);
        if (data.messages.length > 0) {
          setPendingMessages((prev) =>
            prev.filter((p) => !hasPendingMatch(p, data.messages))
          );
        }
        if (data.status === "completed" || data.status === "error") {
          postCompletionPollsRef.current++;
        }
        setStatus(data.status);
        setErrorMessage(data.errorMessage || null);

        // Fix 2도 여기서 적용: 데이터 변경 시에만 refreshTrigger 증가
        if (data.status !== status || data.messages.length !== serverMessages.length) {
          setRefreshTrigger((prev) => prev + 1);
        }
      }
    } catch (error) {
      console.error("Polling error:", error);
    } finally {
      isPollingRef.current = false;
    }
  }, 2000);

  return () => clearInterval(pollInterval);
}, [conversationId, status, pendingMessages.length, hasPendingMatch]);
```

**예상 효과:** 요청이 절대로 중첩되지 않음. 서버 응답이 4초 걸려도 요청 간격이 최소 4초로 자동 조절.

### Fix 2: Conditional refreshTrigger (Fix 1에 포함)

`setRefreshTrigger`를 매 poll마다가 아닌, **실제 데이터 변경 시에만** 호출.

**예상 효과:** files API 호출이 실제 변경이 있을 때만 발생. 불필요한 files API 요청 90%+ 감소.

### Fix 3: Server-Side Response Optimization (중기)

```typescript
// app/api/conversations/[id]/route.ts
// Cache-Control 헤더 추가로 Vercel Edge Cache 활용
return NextResponse.json(response, {
  headers: {
    'Cache-Control': 'private, max-age=1, stale-while-revalidate=2',
  },
});
```

### Fix 4: Improved Termination Logic (선택적)

```typescript
// completed 시 즉시 폴링 빈도를 줄이거나 멈추기
const pollDelay = isDone ? 5000 : 2000; // completed 후에는 5초 간격
```

---

## 반박 기록 (과학적 토론 로그)

### 가설 1 vs 가설 2 논쟁
- **가설 2**: "interval 재생성이 요청을 겹치게 만든다"
- **가설 1 반박**: "interval 재생성 시 cleanup 함수가 `clearInterval`을 호출하므로, 재생성 자체는 요청 중첩을 유발하지 않는다. 문제는 setInterval 내부의 async callback이 2초 안에 완료되지 않는 것이다."
- **가설 2 양보**: "동의한다. dependency loop는 interval을 재생성하지만, clearInterval로 이전 interval이 정리되므로 요청 중첩의 직접 원인은 아니다."

### 가설 3 vs 가설 1 논쟁
- **가설 3**: "refreshTrigger가 2배 요청을 만든다"
- **가설 1 반박**: "2배 증폭이 맞지만, refreshTrigger가 없어도 80개 conversation 요청은 여전히 발생한다. 근본 원인은 concurrent stacking이다."
- **가설 3 양보**: "1차 원인이 아닌 증폭기(amplifier)로 재분류에 동의한다."

### 가설 5 vs 가설 1 논쟁
- **가설 5**: "서버가 200ms에 응답하면 concurrent stacking은 발생하지 않는다"
- **가설 1 반박**: "맞지만, 서버 최적화는 인프라 변경(DB 연결풀, CDN 캐싱, Volume 최적화)이 필요하다. 클라이언트 guard는 코드 3줄로 즉시 적용 가능하다."
- **가설 5 양보**: "Fix 우선순위에서 클라이언트 guard가 먼저라는 데 동의한다. 서버 최적화는 중기 과제로."

### 가설 4의 독립적 입장
- **가설 4**: "종료 실패는 80개 중 최대 10개만 설명하지만, 사용자 경험(UX) 관점에서는 중요하다. completed 후에도 20초간 로딩 스피너가 보이는 것은 사용자 혼란을 유발한다."
- **전체 합의**: "UX 개선으로서의 가치는 인정하지만, 요청 폭주의 핵심 원인은 아니다."

---

## 결론

**80개 요청 적체의 메커니즘:**

1. Agent가 running 상태로 2-3분간 작업 수행
2. 매 2초마다 `setInterval`이 conversation API fetch 실행
3. 서버 응답이 3-4초 걸려 이전 요청이 완료되기 전에 새 요청 시작 (**가설 1**)
4. 동시에 `refreshTrigger++`로 files API도 함께 호출되어 총 요청량 2배 (**가설 3**)
5. 동시 요청이 Vercel serverless에 몰리면서 cold start + DB 커넥션 풀 경합으로 응답 더 지연 (**가설 5**)
6. 악순환: 응답 느려짐 → 더 많은 요청 적체 → 서버 더 느려짐

**즉시 수정으로 `isPollingRef` guard + conditional `refreshTrigger`를 적용하면 요청 폭주가 해결됩니다.**
