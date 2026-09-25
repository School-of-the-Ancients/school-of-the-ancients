/** A teaching request, never executable commands or proof that a scene exists. */
export interface MentorDemonstrationIntent {
  kind: 'matrix-scene';
  title: string;
  learningGoal: string;
  prompt: string;
}

export function validMentorDemonstration(value: unknown): value is MentorDemonstrationIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof item[key] === 'string'
    && item[key].trim().length > 0 && item[key].length <= max
    && !/[\u0000-\u001f\u007f]/.test(item[key]);
  return Object.keys(item).length === 4 && ['kind', 'title', 'learningGoal', 'prompt'].every(key => Object.hasOwn(item, key)) && item.kind === 'matrix-scene'
    && text('title', 120) && text('learningGoal', 500) && text('prompt', 2000);
}
