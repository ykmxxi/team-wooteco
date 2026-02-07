"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { CCMessages } from "@/components/chat/cc-messages";
import { PromptForm } from "@/components/chat/prompt-form";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import type { SessionEntry, ConversationResponse } from "@/lib/types";
import { PanelRight } from "lucide-react";

// Pending message type for optimistic UI
interface PendingMessage {
  id: string;
  content: string;
  timestamp: string;
}

export default function Home() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConversationResponse["status"]>("idle");
  const [serverMessages, setServerMessages] = useState<SessionEntry[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showWorkspace, setShowWorkspace] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track post-completion poll attempts to avoid infinite polling
  const postCompletionPollsRef = useRef(0);

  // Guard against concurrent polling requests (Fix 1: Concurrent Request Guard)
  const isPollingRef = useRef(false);

  // Track previous poll data for accurate change detection (avoids stale closure)
  const prevPollDataRef = useRef({ status: "", messagesLength: 0 });

  // Extract text from a user message content (handles both string and ContentBlock[]).
  const getUserMessageText = useCallback((content: string | unknown[]): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === "text" && b.text)
        .map((b: any) => b.text)
        .join("\n");
    }
    return "";
  }, []);

  // Check if a pending message has a matching user message in server data.
  // Used to remove pending messages once the server confirms them.
  const hasPendingMatch = useCallback(
    (pending: PendingMessage, serverMsgs: SessionEntry[]) => {
      return serverMsgs.some(
        (m) =>
          m.type === "user" &&
          getUserMessageText(m.message.content) === pending.content
      );
    },
    [getUserMessageText]
  );

  // Polling for conversation updates
  // Keeps polling while "running", and also after "completed"/"error" if
  // pending messages haven't appeared in server data yet (volume sync delay).
  useEffect(() => {
    if (!conversationId) return;

    const isDone = status === "completed" || status === "error";

    // Stop polling once done AND all pending messages are resolved (or retries exhausted)
    if (isDone && (pendingMessages.length === 0 || postCompletionPollsRef.current >= 10)) return;
    if (!isDone && status !== "running") return;

    const pollInterval = setInterval(async () => {
      if (isPollingRef.current) return; // 이전 요청 진행 중이면 skip
      isPollingRef.current = true;
      try {
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (response.ok) {
          const data: ConversationResponse = await response.json();

          // Update server messages
          setServerMessages(data.messages);

          // Remove only the pending messages that now appear in server data.
          // This handles both first-turn (no prior messages) and multi-turn
          // (prior messages exist but new ones haven't synced yet).
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

          // 이전 poll 데이터와 비교하여 변경 시에만 refreshTrigger 증가
          // (stale closure 방지를 위해 ref 사용)
          const prev = prevPollDataRef.current;
          if (data.status !== prev.status || data.messages.length !== prev.messagesLength) {
            setRefreshTrigger((r) => r + 1);
          }
          prevPollDataRef.current = { status: data.status, messagesLength: data.messages.length };
        }
      } catch (error) {
        console.error("Polling error:", error);
      } finally {
        isPollingRef.current = false;
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [conversationId, status, pendingMessages.length, hasPendingMatch]);

  // 에이전트 완료 후 volume sync 지연을 고려한 추가 workspace 새로고침
  // status callback에서 3초 대기 후 sandbox kill → 파일이 volume API에 반영되기까지 시간 필요
  useEffect(() => {
    if (status !== "completed" && status !== "error") return;

    const timers = [
      setTimeout(() => setRefreshTrigger((r) => r + 1), 2000),
      setTimeout(() => setRefreshTrigger((r) => r + 1), 5000),
    ];

    return () => timers.forEach(clearTimeout);
  }, [status]);

  // Compute combined messages: server messages + pending messages as SessionEntry
  const messages: SessionEntry[] = [
    ...serverMessages,
    ...pendingMessages.map((p): SessionEntry => ({
      type: "user",
      uuid: p.id,
      parentUuid: serverMessages.length > 0 ? serverMessages[serverMessages.length - 1].uuid : null,
      sessionId: "",
      timestamp: p.timestamp,
      isSidechain: false,
      message: {
        role: "user",
        content: p.content,
      },
    })),
  ];

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [serverMessages, pendingMessages]);

  const handleSubmit = useCallback(
    async (content: string) => {
      setIsSubmitting(true);
      setErrorMessage(null);
      postCompletionPollsRef.current = 0;

      // Add pending message immediately for optimistic UI
      const pendingId = `pending-${Date.now()}`;
      const pendingMsg: PendingMessage = {
        id: pendingId,
        content,
        timestamp: new Date().toISOString(),
      };
      setPendingMessages((prev) => [...prev, pendingMsg]);

      try {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            content,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to send message");
        }

        const data = await response.json();
        setConversationId(data.conversationId);
        setStatus("running");
      } catch (error) {
        // Remove pending message on error
        setPendingMessages((prev) => prev.filter((m) => m.id !== pendingId));
        setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsSubmitting(false);
      }
    },
    [conversationId]
  );

  const isLoading = status === "running" || isSubmitting;
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header - minimal like Maru */}
      <header className="flex items-center justify-between border-b border-border px-4 h-[52px]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">hackathon-starter</span>
        </div>
        {!showWorkspace && (
          <button
            onClick={() => setShowWorkspace(true)}
            className="p-1.5 hover:bg-muted rounded transition-colors"
            title="Open workspace"
          >
            <PanelRight className="size-4 text-muted-foreground" />
          </button>
        )}
      </header>

      {/* Main content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Chat panel */}
        <ResizablePanel defaultSize={showWorkspace ? 55 : 100} minSize={40}>
          <div className="flex h-full flex-col">
            {/* Messages area */}
            <div className="flex-1 overflow-auto">
              {!hasMessages ? (
                <div className="flex h-full flex-col items-center justify-center px-4">
                  <h1 className="font-mono text-lg mb-6">
                    ✳ What can I help with?
                  </h1>
                  <div className="w-full max-w-xl">
                    <PromptForm
                      onSubmit={handleSubmit}
                      isLoading={isLoading}
                      disabled={status === "running"}
                      placeholder="Ask anything"
                    />
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto px-4 py-6">
                  <CCMessages entries={messages} />
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Error display */}
            {errorMessage && (
              <div className="mx-4 mb-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </div>
            )}

            {/* Status indicator */}
            {status === "running" && hasMessages && (
              <div className="mx-4 mb-2 text-sm text-muted-foreground">
                <span className="animate-pulse">Processing...</span>
              </div>
            )}

            {/* Bottom prompt form (only when there are messages) */}
            {hasMessages && (
              <div className="border-t border-border p-4">
                <div className="max-w-3xl mx-auto">
                  <PromptForm
                    onSubmit={handleSubmit}
                    isLoading={isLoading}
                    disabled={status === "running"}
                    placeholder="Follow-up message..."
                  />
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>

        {showWorkspace && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={45} minSize={25}>
              <WorkspacePanel
                conversationId={conversationId}
                refreshTrigger={refreshTrigger}
                onClose={() => setShowWorkspace(false)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
