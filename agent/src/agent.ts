#!/usr/bin/env node
/**
 * Hackathon Starter Agent - Claude Agent SDK integration for Moru sandbox.
 *
 * Protocol:
 * 1. Read process_start from stdin (with optional session_id for resume)
 * 2. Read session_message from stdin (user's prompt)
 * 3. Emit session_started with sessionId to stdout
 * 4. Call Claude Agent SDK query() with prompt
 * 5. On completion/error, call CALLBACK_URL to update status
 */

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Debug logging helper
function debug(msg: string, data?: any): void {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.error(`[DEBUG ${timestamp}] ${msg}:`, JSON.stringify(data, null, 2));
  } else {
    console.error(`[DEBUG ${timestamp}] ${msg}`);
  }
}

// Types for our protocol
interface ProcessStartCommand {
  type: "process_start";
  session_id?: string;
}

interface SessionMessageCommand {
  type: "session_message";
  text?: string;
  content?: Array<{ type: string; text?: string }>;
}

interface AgentMessage {
  type: string;
  session_id?: string;
  message?: string;
  result?: {
    duration_ms?: number;
    duration_api_ms?: number;
    total_cost_usd?: number | null;
    num_turns?: number;
  };
}

function emit(msg: AgentMessage): void {
  console.log(JSON.stringify(msg));
}

function parseContent(msg: SessionMessageCommand): string {
  if (msg.text) return msg.text;
  if (msg.content) {
    return msg.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n");
  }
  return "";
}

/**
 * Line reader that buffers incoming lines for reliable reading.
 * This handles the case where stdin is piped quickly and multiple
 * lines arrive before we're ready to read them.
 */
class LineReader {
  private lines: string[] = [];
  private resolvers: ((line: string | null) => void)[] = [];
  private closed = false;

  constructor(rl: readline.Interface) {
    rl.on("line", (line) => {
      debug("LineReader received line", { lineLength: line.length, waitingResolvers: this.resolvers.length, bufferedLines: this.lines.length });
      if (this.resolvers.length > 0) {
        // Someone is waiting for a line, resolve immediately
        debug("LineReader: resolving immediately");
        const resolve = this.resolvers.shift()!;
        resolve(line);
      } else {
        // Buffer the line for later
        debug("LineReader: buffering line");
        this.lines.push(line);
      }
    });

    rl.on("close", () => {
      debug("LineReader: stdin closed", { pendingResolvers: this.resolvers.length, bufferedLines: this.lines.length });
      this.closed = true;
      // Resolve all pending readers with null
      while (this.resolvers.length > 0) {
        const resolve = this.resolvers.shift()!;
        resolve(null);
      }
    });
  }

  async readLine(): Promise<string | null> {
    // Check if we have buffered lines
    if (this.lines.length > 0) {
      return this.lines.shift()!;
    }

    // Check if stream is closed
    if (this.closed) {
      return null;
    }

    // Wait for next line
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

/**
 * Flush filesystem buffers so JuiceFS uploads pending writes to object storage.
 * Must be called before the callback so the session JSONL is readable via the volume API.
 */
function flushVolume(): void {
  try {
    debug("Flushing volume (sync)...");
    execSync("sync", { timeout: 10_000 });
    debug("Volume flush complete");
  } catch (e) {
    debug("Volume flush failed (non-fatal)", { error: String(e) });
  }
}

async function callCallback(status: "completed" | "error", sessionId?: string, errorMessage?: string) {
  const callbackUrl = process.env.CALLBACK_URL;
  if (!callbackUrl) {
    console.error("[AGENT] No CALLBACK_URL set, skipping callback");
    return;
  }

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        sessionId,
        errorMessage,
      }),
    });

    if (!response.ok) {
      console.error(`[AGENT] Callback failed: ${response.status}`);
    }
  } catch (error) {
    console.error("[AGENT] Callback error:", error);
  }
}

// ─── YouTube API Types ───────────────────────────────────────────────

interface YouTubeVideoResult {
  title: string;
  channel: string;
  url: string;
  views: number;
  likes: number;
  published_at: string;
  duration: string;
  description_snippet: string;
}

interface YouTubePlaylistResult {
  title: string;
  channel: string;
  url: string;
  video_count: number;
  published_at: string;
  description_snippet: string;
}

// ─── YouTube API Helpers ─────────────────────────────────────────────

async function searchYouTubeVideos(params: {
  query: string;
  language?: string;
  max_results?: number;
  video_duration?: string;
}): Promise<YouTubeVideoResult[]> {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error("[YouTube] YOUTUBE_API_KEY not set");
      return [];
    }

    // Step 1: search.list (type=video)
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: params.query,
      maxResults: String(params.max_results || 5),
      order: "relevance",
      key: apiKey,
    });
    if (params.language && params.language !== "any") {
      searchParams.set("relevanceLanguage", params.language);
    }
    if (params.video_duration && params.video_duration !== "any") {
      searchParams.set("videoDuration", params.video_duration);
    }

    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${searchParams}`
    );
    if (!searchRes.ok) {
      console.error(`[YouTube] search.list failed: ${searchRes.status}`);
      return [];
    }
    const searchData = await searchRes.json();
    const items = searchData.items || [];
    if (items.length === 0) return [];

    const videoIds = items.map((i: any) => i.id.videoId).join(",");

    // Step 2: videos.list (statistics + contentDetails)
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
        part: "snippet,statistics,contentDetails",
        id: videoIds,
        key: apiKey,
      })}`
    );
    if (!videosRes.ok) {
      console.error(`[YouTube] videos.list failed: ${videosRes.status}`);
      return [];
    }
    const videosData = await videosRes.json();
    const videoDetails = new Map<string, any>();
    for (const v of videosData.items || []) {
      videoDetails.set(v.id, v);
    }

    // Merge results
    return items.map((item: any) => {
      const videoId = item.id.videoId;
      const detail = videoDetails.get(videoId);
      return {
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        views: detail ? Number(detail.statistics?.viewCount || 0) : 0,
        likes: detail ? Number(detail.statistics?.likeCount || 0) : 0,
        published_at: item.snippet.publishedAt,
        duration: detail?.contentDetails?.duration || "unknown",
        description_snippet: (item.snippet.description || "").slice(0, 200),
      };
    });
  } catch (error) {
    console.error("[YouTube] searchYouTubeVideos error:", error);
    return [];
  }
}

async function searchYouTubePlaylists(params: {
  query: string;
  language?: string;
  max_results?: number;
}): Promise<YouTubePlaylistResult[]> {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error("[YouTube] YOUTUBE_API_KEY not set");
      return [];
    }

    // Step 1: search.list (type=playlist)
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "playlist",
      q: params.query,
      maxResults: String(params.max_results || 3),
      order: "relevance",
      key: apiKey,
    });
    if (params.language && params.language !== "any") {
      searchParams.set("relevanceLanguage", params.language);
    }

    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${searchParams}`
    );
    if (!searchRes.ok) {
      console.error(`[YouTube] search.list (playlist) failed: ${searchRes.status}`);
      return [];
    }
    const searchData = await searchRes.json();
    const items = searchData.items || [];
    if (items.length === 0) return [];

    const playlistIds = items.map((i: any) => i.id.playlistId).join(",");

    // Step 2: playlists.list (contentDetails for videoCount)
    const playlistsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlists?${new URLSearchParams({
        part: "snippet,contentDetails",
        id: playlistIds,
        key: apiKey,
      })}`
    );
    if (!playlistsRes.ok) {
      console.error(`[YouTube] playlists.list failed: ${playlistsRes.status}`);
      return [];
    }
    const playlistsData = await playlistsRes.json();
    const playlistDetails = new Map<string, any>();
    for (const p of playlistsData.items || []) {
      playlistDetails.set(p.id, p);
    }

    // Merge results
    return items.map((item: any) => {
      const playlistId = item.id.playlistId;
      const detail = playlistDetails.get(playlistId);
      return {
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        video_count: detail?.contentDetails?.itemCount || 0,
        published_at: item.snippet.publishedAt,
        description_snippet: (item.snippet.description || "").slice(0, 200),
      };
    });
  } catch (error) {
    console.error("[YouTube] searchYouTubePlaylists error:", error);
    return [];
  }
}

// ─── Inflearn Types ─────────────────────────────────────────────────

interface InfLearnCourseResult {
  title: string;
  instructor: string;
  url: string;
  price: number;
  regular_price: number;
  discount_rate: number;
  is_free: boolean;
  rating: number;
  student_count: number;
  description_snippet: string;
}

// ─── Inflearn API Helper ────────────────────────────────────────────

async function searchInflearn(params: {
  query: string;
  max_results?: number;
}): Promise<InfLearnCourseResult[]> {
  try {
    const url = `https://www.inflearn.com/courses?s=${encodeURIComponent(params.query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) return [];

    const html = await res.text();

    const match = html.match(
      /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s
    );
    if (!match) return [];

    const nextData = JSON.parse(match[1]);
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
    if (!queries || queries.length < 2) return [];

    const items = queries[1]?.state?.data?.items || [];
    const maxResults = params.max_results || 3;

    return items.slice(0, maxResults).map((item: any) => ({
      title: item.course?.title || "",
      instructor: item.instructor?.name || "",
      url: `https://www.inflearn.com/course/${item.course?.slug}`,
      price: item.listPrice?.payPrice || 0,
      regular_price: item.listPrice?.regularPrice || 0,
      discount_rate: item.listPrice?.discountRate || 0,
      is_free: item.listPrice?.isFree || false,
      rating: item.course?.star || 0,
      student_count: item.course?.studentCount || 0,
      description_snippet: (item.course?.description || "").slice(0, 200),
    }));
  } catch (error) {
    console.error("[Inflearn] searchInflearn error:", error);
    return [];
  }
}

// ─── MCP Server (Learning Tools) ────────────────────────────────────

const learningToolsServer = createSdkMcpServer({
  name: "learning-tools",
  version: "1.0.0",
  tools: [
    tool(
      "youtube_search",
      "YouTube에서 학습 영상을 검색합니다. 커리큘럼 단계별 키워드로 호출하세요.",
      z.object({
        query: z.string().describe("검색 키워드 (예: '쿠버네티스 입문 강의')"),
        language: z.enum(["ko", "en", "any"]).default("any").describe("콘텐츠 언어 필터"),
        max_results: z.number().default(5).describe("최대 결과 수"),
        video_duration: z.enum(["short", "medium", "long", "any"]).default("any").describe("영상 길이 필터"),
      }),
      async (args) => {
        const results = await searchYouTubeVideos(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      }
    ),
    tool(
      "youtube_playlist_search",
      "YouTube에서 학습 플레이리스트를 검색합니다. 시리즈 강의를 찾을 때 사용하세요.",
      z.object({
        query: z.string().describe("검색 키워드"),
        language: z.enum(["ko", "en", "any"]).default("any").describe("콘텐츠 언어 필터"),
        max_results: z.number().default(3).describe("최대 결과 수"),
      }),
      async (args) => {
        const results = await searchYouTubePlaylists(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      }
    ),
    tool(
      "inflearn_search",
      "인프런에서 온라인 강의를 검색합니다. 커리큘럼 키워드로 유사 유료 강의를 찾을 때 사용하세요.",
      z.object({
        query: z.string().describe("검색 키워드 (예: 'Spring Boot 입문')"),
        max_results: z.number().default(3).describe("최대 결과 수"),
      }),
      async (args) => {
        const results = await searchInflearn(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      }
    ),
  ],
});

// ─── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 학습 로드맵 큐레이터입니다.

사용자가 배우고 싶은 주제를 입력하면, 다음 순서로 맞춤형 학습 로드맵을 생성하세요.
모든 단계를 한 번에 수행하여 최종 로드맵까지 완성합니다. 사용자에게 추가 질문하지 마세요.

## 1단계: 사용자 프로필 추정
- 메시지에서 현재 수준, 목표, 배경 지식을 추정합니다
- 정보가 부족하면 합리적으로 가정합니다 (중급 개발자, 실무 적용 목표 등)
- 추정한 프로필을 먼저 간단히 공유합니다

## 2단계: 커리큘럼 뼈대 설계
- 선수 지식 갭을 분석합니다
- 3~5단계로 구성합니다: 필요시 선수 보충 → 입문 → 핸즈온 → 심화 → 실무
- 각 단계별 서브 토픽 2~3개를 정합니다

## 3단계: 유튜브 콘텐츠 탐색
- youtube_search, youtube_playlist_search tool을 사용하여 실제 검색합니다
- 각 단계별로 적절한 한국어/영어 키워드로 검색합니다
- 플레이리스트를 먼저 찾고, 부족하면 단일 영상으로 보완합니다
- 각 단계별 메인 추천 1개 + 대안 1개를 선정합니다

## 3.5단계: 유료 강의 플랫폼 탐색
- 각 커리큘럼 단계의 핵심 키워드로 인프런/유데미를 검색합니다
- **인프런**: inflearn_search tool을 사용하여 검색합니다
- **유데미**: WebSearch tool로 "site:udemy.com {키워드} 강의" 형태로 검색합니다
- 각 단계별로 관련 유료 강의가 있으면 1~2개를 선정합니다
- 유료 강의는 가격, 평점, 수강생 수를 기준으로 선정합니다
- 관련 강의를 찾지 못하면 해당 단계는 건너뜁니다

## 4단계: 로드맵 생성
- 마크다운 형식으로 최종 로드맵을 작성합니다
- Write tool을 사용하여 /workspace/data/roadmap.md 에 저장합니다
- 채팅에도 로드맵 전체를 보여줍니다

로드맵에 포함할 항목:
- 대상 프로필 요약
- 예상 총 학습 시간 및 기간
- 단계별 추천 콘텐츠 (제목, 채널, URL, 조회수, 재생시간)
- 단계별 유료 강의 추천 (인프런/유데미, 가격, 평점, 수강생 수)
- 각 단계 완료 후 체크포인트 (실습 과제)
- 메인 추천과 대안 추천 구분

## 출력 형식 예시

각 단계별로 다음과 같이 구성합니다:

### 🟢 1단계: [단계명] (N주차)
**유튜브 추천**
- 📺 [제목](URL) - 채널명 | 조회수 N만 | ⏱️ N시간
**대안**
- 📺 [제목](URL) - 채널명 | 조회수 N만 | ⏱️ N시간

**📚 유료 강의 추천** *(선택사항)*
- 🎓 [인프런] [제목](URL) - 강사명 | ⭐ N.N | 수강생 N명 | 💰 N원 (N% 할인)
- 🎓 [유데미] [제목](URL) - 강사명 | ⭐ N.N

**체크포인트**: [실습 과제 설명]
`;

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const workspace = process.env.WORKSPACE_DIR || process.cwd();
  const resumeSessionId = process.env.RESUME_SESSION_ID || undefined;

  // Debug: Log startup info
  debug("Agent starting");
  debug("Environment", {
    workspace,
    resumeSessionId,
    HOME: process.env.HOME,
    CALLBACK_URL: process.env.CALLBACK_URL,
    cwd: process.cwd(),
  });

  // Debug: Check credentials
  const credentialsPath = path.join(process.env.HOME || "/home/user", ".claude", ".credentials.json");
  const credentialsExists = fs.existsSync(credentialsPath);
  debug("Credentials check", {
    path: credentialsPath,
    exists: credentialsExists,
  });

  if (credentialsExists) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
      const expiresAt = creds?.claudeAiOauth?.expiresAt;
      if (expiresAt) {
        const expires = new Date(expiresAt);
        debug("Credentials expiry", {
          expiresAt: expires.toISOString(),
          isExpired: Date.now() > expiresAt,
        });
      }
    } catch (e) {
      debug("Failed to parse credentials", { error: String(e) });
    }
  }

  // Debug: List ~/.claude directory
  const claudeDir = path.join(process.env.HOME || "/home/user", ".claude");
  try {
    const claudeFiles = fs.readdirSync(claudeDir);
    debug("~/.claude directory contents", claudeFiles);
  } catch (e) {
    debug("Failed to list ~/.claude", { error: String(e) });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  const reader = new LineReader(rl);
  debug("LineReader initialized, waiting for stdin...");

  try {
    // Wait for process_start
    debug("Waiting for process_start...");
    const startLine = await reader.readLine();
    debug("Received line", { startLine });
    if (!startLine) {
      emit({ type: "process_error", message: "No input received" });
      return;
    }

    let startMsg: ProcessStartCommand;
    try {
      startMsg = JSON.parse(startLine);
    } catch {
      emit({ type: "process_error", message: "Invalid JSON for process_start" });
      return;
    }

    if (startMsg.type !== "process_start") {
      emit({ type: "process_error", message: "Expected process_start" });
      return;
    }

    // Use session_id from message or env
    const sessionIdToResume = startMsg.session_id || resumeSessionId || undefined;

    debug("Emitting process_ready", { sessionIdToResume });
    emit({
      type: "process_ready",
      session_id: sessionIdToResume || "pending",
    });

    // Wait for session_message
    debug("Waiting for session_message...");
    const msgLine = await reader.readLine();
    debug("Received line", { msgLine });
    if (!msgLine) {
      emit({ type: "process_error", message: "No session_message received" });
      return;
    }

    let sessionMsg: SessionMessageCommand;
    try {
      sessionMsg = JSON.parse(msgLine);
    } catch {
      emit({ type: "process_error", message: "Invalid JSON for session_message" });
      return;
    }

    if (sessionMsg.type !== "session_message") {
      emit({ type: "process_error", message: "Expected session_message" });
      return;
    }

    const prompt = parseContent(sessionMsg);
    if (!prompt) {
      emit({ type: "process_error", message: "Empty prompt" });
      return;
    }

    let currentSessionId: string | undefined = sessionIdToResume;
    let gotResult = false;

    debug("Starting query()", {
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""),
      workspace,
      resumeSessionId: sessionIdToResume,
    });

    // Run the agent
    for await (const message of query({
      prompt,
      options: {
        allowedTools: [
          "Read", "Write", "Edit", "Bash", "Grep", "Glob",
          "WebSearch", "WebFetch", "TodoWrite", "Task",
        ],
        mcpServers: {
          "learning-tools": learningToolsServer,
        },
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 50,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true, // Required when using bypassPermissions
        cwd: workspace,
        resume: sessionIdToResume,
        settingSources: ["user", "project"], // Load ~/.claude/CLAUDE.md, skills, and project settings
      },
    })) {
      // Debug: Log each message type from query
      debug("Query message", { type: message.type, subtype: (message as any).subtype });

      // Capture session_id from init message
      if (message.type === "system" && (message as any).subtype === "init") {
        currentSessionId = (message as any).session_id;
        emit({
          type: "session_started",
          session_id: currentSessionId,
        });
      }

      // Handle result message
      if ("result" in message && message.type === "result") {
        gotResult = true;
        const resultMsg = message as any;

        emit({
          type: "session_complete",
          session_id: currentSessionId,
          result: {
            duration_ms: resultMsg.duration_ms,
            duration_api_ms: resultMsg.duration_api_ms,
            total_cost_usd: resultMsg.total_cost_usd,
            num_turns: resultMsg.num_turns,
          },
        });

        // Flush volume before callback so session JSONL is persisted
        flushVolume();
        await callCallback("completed", currentSessionId);
      }
    }

    // If we didn't get a result, still call callback
    if (!gotResult) {
      console.error("[AGENT] Warning: query() ended without result");
      emit({
        type: "session_complete",
        session_id: currentSessionId,
        result: {
          duration_ms: 0,
          duration_api_ms: 0,
          total_cost_usd: 0,
          num_turns: 0,
        },
      });
      flushVolume();
      await callCallback("completed", currentSessionId);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[AGENT] Exception:", errorMessage);
    emit({ type: "process_error", message: errorMessage });
    flushVolume();
    await callCallback("error", undefined, errorMessage);
  } finally {
    rl.close();
    emit({ type: "process_stopped" });
  }
}

main().catch((error) => {
  console.error("[AGENT] Fatal error:", error);
  process.exit(1);
});
