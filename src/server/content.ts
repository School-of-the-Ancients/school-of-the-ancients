import type { Lesson, Mentor, LessonStage } from '../shared/contracts.ts';

export const STAGES: LessonStage[] = ['explain', 'example', 'guided_practice', 'socratic_check', 'recap', 'ended'];
export const GALILEO: Mentor = {
  id: 'galileo', name: 'Galileo Galilei', title: 'A guide to observation',
  description: 'Ask questions, make predictions, and compare them with an experiment. A historically inspired teaching character, not a reconstruction of the real person.',
  timeframe: '1564–1642', expertise: ['Observation', 'Measurement', 'Geometry'], initials: 'GG',
  promptVersion: 'galileo-observation-1',
  disclosure: 'AI interpretation of a historical figure. This lesson and its dialogue are modern educational material, not historical quotations.',
};
export const OBSERVATION_LESSON: Lesson = {
  id: 'observation-and-scale', version: '1.0.0', title: 'A small change. A bigger question.',
  description: 'Predict what happens when a block grows, test it, and explain what your observations mean.',
  objective: 'Distinguish side-length changes from volume changes using a rectangular block.',
  duration: '5–10 minutes', mentorId: GALILEO.id,
  requiredCapabilities: ['lesson.text.v1', 'experiment.scale.v1'], optionalCapabilities: ['mentor.voice.v1', 'matrix.scene.v1'],
  sources: [{ id: 'authored-scale-v1', title: 'Observation and Scale — authored activity', kind: 'authored', description: 'For a rectangular block, volume = width × height × depth. Doubling all three dimensions multiplies volume by eight. This browser experiment models geometry, not mass, gravity, or physical measurement.' }],
  stages: [
    { stage: 'explain', title: 'Look closely', explanation: 'A block has three side lengths: width, height, and depth. Its volume is the product of those three lengths. We will change the dimensions, observe the result, and compare it with a prediction.', prompt: 'Start with a 1 × 1 × 1 block. What might “twice as big” mean?', suggestedQuestions: ['What is the difference between length and volume?', 'Can you explain volume simply?'] },
    { stage: 'example', title: 'Make a prediction', explanation: 'If only the width changes from 1 to 2, volume changes from 1 × 1 × 1 = 1 to 2 × 1 × 1 = 2 cubic units. Now consider changing all three dimensions.', prompt: 'Predict the volume if the width, height, and depth all become 2. Explain your prediction before experimenting.', suggestedQuestions: ['Why do we multiply the dimensions?', 'Would doubling height have the same effect as doubling width?'] },
    { stage: 'guided_practice', title: 'Try your idea', explanation: 'Set width, height, and depth to 2, then apply the experiment. Read the recorded dimensions and volume. Compare these observations with your prediction.', prompt: 'Apply a 2 × 2 × 2 experiment, then describe what changed and what stayed the same.', suggestedQuestions: ['What if I only double the width?', 'Can I undo this experiment?'] },
    { stage: 'socratic_check', title: 'Explain the evidence', explanation: 'The recorded dimensions can establish the geometry. Your explanation shows how you connect that evidence to your prediction.', prompt: 'Why did doubling every side produce eight times the volume, rather than twice the volume?', suggestedQuestions: ['Can you give me a hint?', 'How would I explain this using small unit blocks?'] },
    { stage: 'recap', title: 'Take the idea with you', explanation: 'Side-length and volume changes are different. Doubling all three dimensions gives 2 × 2 × 2 = 8 times the volume; doubling just one dimension gives twice the volume.', prompt: 'What changed in your thinking, and what would you test next?', suggestedQuestions: ['What would happen if each side tripled?', 'Where might this idea be useful?'] },
    { stage: 'ended', title: 'An experiment worth remembering', explanation: 'Your prediction, experiment, explanation, and reflection are saved on this PC. You can return to this conversation or export the record.', prompt: 'Activity completed. Participation was recorded; mastery was not assessed.', suggestedQuestions: [] },
  ],
};
export function stageContent(lesson: Lesson, stage: LessonStage) {
  const content = lesson.stages.find((item) => item.stage === stage);
  if (!content) throw new Error('Lesson stage is unavailable');
  return structuredClone(content);
}
