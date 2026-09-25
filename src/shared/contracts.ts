/** Versioned standalone School contract. Matrix is an optional integration, not a prerequisite. */
import type { MentorDemonstrationIntent } from './mentor-demonstration.ts';
export type { MentorDemonstrationIntent } from './mentor-demonstration.ts';
export const API_VERSION = 1 as const;
export type LessonStage = 'explain' | 'example' | 'guided_practice' | 'socratic_check' | 'recap' | 'ended';
export type TurnKind = 'question' | 'answer' | 'advance';
export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type ProviderMode = 'demo' | 'codex-cli';
export interface Mentor {
  id: string; name: string; title: string; description: string; timeframe: string;
  expertise: string[]; portraitUrl?: string; initials: string; promptVersion: string; disclosure: string;
}
export interface LessonSource { id: string; title: string; description: string; url?: string; kind: 'authored' | 'reference'; }
export interface LessonStageContent { stage: LessonStage; title: string; explanation: string; prompt: string; suggestedQuestions: string[]; }
export interface Lesson {
  id: string; version: string; title: string; description: string; objective: string; duration: string;
  mentorId: string; stages: LessonStageContent[]; sources: LessonSource[];
  requiredCapabilities: string[]; optionalCapabilities: string[];
}
export interface ScaleArtifact {
  type: 'scale'; dimensions: [number, number, number]; baseline: [number, number, number];
  volume: number; volumeRatio: number; units: 'units'; observedAt: string; source: 'browser-deterministic';
}
export interface LessonMessage {
  id: string; role: 'learner' | 'mentor' | 'system'; text: string; stage: LessonStage;
  createdAt: string; turnId?: string; providerMode?: ProviderMode;
  demonstration?: MentorDemonstrationIntent;
}
export interface LessonEvent { id: string; type: 'session_started' | 'stage_changed' | 'experiment_applied' | 'turn_cancelled' | 'turn_failed' | 'turn_interrupted'; createdAt: string; stage: LessonStage; details: string; }
export interface SchoolSession {
  id: string; revision: number; mentorId: string; lessonId: string; lessonVersion: string;
  mentor: Mentor; lesson: Lesson; stage: LessonStage; stageContent: LessonStageContent;
  status: 'active' | 'completed'; messages: LessonMessage[]; events: LessonEvent[];
  artifact: ScaleArtifact; activeTurnId?: string; createdAt: string; updatedAt: string; savedAt: string;
  completionLabel: string;
  /** Optional local companion ledger; never contains Matrix credentials or raw room captures. */
  matrix?: MatrixLessonLedger;
}
export interface ProviderStatus {
  mode: ProviderMode; label: string; configured: boolean; available: boolean; checked: boolean;
  reason: string; requestedModel?: string; lastSucceededAt?: string;
  lastOutcome?: 'not-run' | 'running' | 'succeeded' | 'failed' | 'cancelled';
}
export interface ProviderReceipt { mode: ProviderMode; requestedModel?: string; actualModel?: string; completedTurn: boolean; toolCallCount: number; }
export interface MentorTurn {
  id: string; sessionId: string; requestId: string; kind: TurnKind; status: TurnStatus; input: string;
  stage: LessonStage; createdAt: string; completedAt?: string; output?: string; error?: string; receipt?: ProviderReceipt;
  demonstration?: MentorDemonstrationIntent;
}
export interface CatalogResponse { apiVersion: 1; mentors: Mentor[]; lessons: Lesson[]; provider: ProviderStatus; }
export interface SessionResponse { apiVersion: 1; session: SchoolSession; }
export interface SessionsResponse { apiVersion: 1; sessions: SchoolSession[]; }
export interface TurnResponse extends SessionResponse { turn: MentorTurn; }
export interface StartSessionRequest { requestId: string; mentorId: string; lessonId: string; }
export interface CreateTurnRequest { requestId: string; expectedRevision: number; kind: TurnKind; text?: string; }
export interface ExperimentRequest { requestId: string; expectedRevision: number; dimensions: [number, number, number]; }
export interface ErrorResponse { apiVersion: 1; error: string; code: string; }

export interface MatrixBindingRecord {
  id: string; origin: string; status: 'pairing' | 'paired' | 'disconnected' | 'unconfirmed' | 'failed';
  createdAt: string; updatedAt: string; matrixSessionId?: string; runtimeSessionId?: string; error?: string;
}
export interface MatrixObjectEvidence {
  objectId: string; assetId: string; anchorId: string;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}
export type MatrixDemonstrationStatus = 'submitting' | 'planning' | 'ready' | 'queued' | 'running' | 'succeeded' |
  'failed' | 'partial' | 'cancelled' | 'stale' | 'unconfirmed' | 'needs_clarification' | 'review_only' | 'error';
export interface MatrixDemonstration {
  id: string; bindingId: string; matrixSessionId: string; runtimeSessionId: string; correlationId: string;
  exhibit: { id: string; version: string; digest: string; identity: import('../exhibits/prepared-exhibits.ts').ExhibitIdentity };
  placement: {
    anchorId: string; position: { x: number; y: number; z: number };
    mode: 'direct' | 'surface'; spawnScale: number;
    bounds?: { center: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } };
  };
  requestText: string; expectedMatrixRevision: number; status: MatrixDemonstrationStatus;
  createdAt: string; updatedAt: string; sequence: number; requiresApply: boolean;
  /** A bounded explanatory summary only. Apply authority belongs to the Matrix operator. */
  proposalSummary: string | null; commandIds: string[];
  receipts: Array<{ requestId: string; ok: boolean; error: string; objectId: string }>;
  observed: { revision: number; objects: MatrixObjectEvidence[]; source: 'matrix-runtime'; roomId?: string } | null;
  error: string | null; lastCheckedAt?: string;
  /** Explicit request failure/uncertainty is separate from the last observed Matrix outcome. */
  checkError?: string;
}
export interface MatrixLessonLedger {
  bindings: MatrixBindingRecord[]; activeBindingId?: string; demonstrations: MatrixDemonstration[];
  experiments?: MatrixScaleExperiment[];
  sceneBuilds?: MatrixSceneBuild[];
}
/** One saved teaching intent, one reviewed Matrix request, and minimal historical execution evidence. */
export interface MatrixSceneBuild {
  id: string; bindingId: string; matrixSessionId: string; runtimeSessionId: string; correlationId: string;
  turnId: string; stage: LessonStage; intent: MentorDemonstrationIntent;
  expectedMatrixRevision: number; status: MatrixDemonstrationStatus; requiresApply: boolean; sequence: number;
  createdAt: string; updatedAt: string; proposalSummary: string | null;
  commandIds: string[]; receipts: MatrixDemonstration['receipts'];
  observed: { source: 'matrix-runtime'; revision: number; confirmedCommandCount: number; failedCommandCount: number; objectIds: string[] }
    | { source: 'matrix-pc-save'; revision: number; savedScene: string } | null;
  error: string | null; lastCheckedAt?: string; checkError?: string;
  /** Digest of the full transient Matrix outcome guards equal-sequence rewriting without retaining scene data. */
  outcomeDigest?: string;
  proposalDigest?: string;
}
export interface MatrixScaleExperiment {
  id: string; bindingId: string; demonstrationId: string; matrixSessionId: string; runtimeSessionId: string; correlationId: string;
  action: 'configure' | 'reset'; factors: import('../integrations/matrix-client.ts').MatrixScaleVector; baselineExperimentId?: string;
  proof: import('../integrations/matrix-client.ts').MatrixScaleProof;
  expectedMatrixRevision: number; status: MatrixDemonstrationStatus; requiresApply: boolean; sequence: number;
  createdAt: string; updatedAt: string; proposalSummary: string | null;
  commandIds: string[]; receipts: MatrixDemonstration['receipts'];
  observed: import('../integrations/matrix-client.ts').MatrixScaleObservation | null;
  error: string | null; lastCheckedAt?: string; checkError?: string;
}
export interface MatrixBridgeResponse extends SessionResponse {
  bridge: {
    binding: MatrixBindingRecord | null; connected: boolean;
    readiness: import('../exhibits/prepared-exhibits.ts').ExhibitPreflight | null;
    checkedAt: string | null; reason: string; operatorUrl: string | null;
    demonstrations: MatrixDemonstration[];
    experiments: MatrixScaleExperiment[];
    sceneBuilds: MatrixSceneBuild[];
    sceneBuilder: { available: boolean; reason: string; expectedMatrixRevision?: number };
    scale: { available: boolean; reason: string; expectedMatrixRevision?: number; demonstrationId?: string; latestExperimentId?: string };
  };
  demonstration?: MatrixDemonstration;
  experiment?: MatrixScaleExperiment;
  sceneBuild?: MatrixSceneBuild;
}
export interface MatrixPairRequest { requestId: string; expectedRevision: number; url: string; pairingCode: string; }
export interface MatrixDisconnectRequest { requestId: string; expectedRevision: number; }
export interface MatrixDemonstrationRequest { requestId: string; expectedRevision: number; bindingId: string; expectedMatrixRevision: number; }
export interface MatrixCancelRequest { requestId: string; }
