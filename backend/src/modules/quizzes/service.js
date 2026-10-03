import { z } from 'zod';
import { query, queryAll, queryOne } from '../../config/database.js';
import { notFound, badRequest, forbidden } from '../../utils/errors.js';
import { awardPoints, syncBadges } from '../../services/gamification.js';
import { assertEnrolled, completeLessonWithoutTime } from '../../services/enrollments.js';

const quizSelect = `
  SELECT q.id, q.lesson_id AS "lessonId", q.title, q.pass_percent AS "passPercent",
         q.max_attempts AS "maxAttempts", q.points_reward AS "pointsReward"
    FROM quizzes q WHERE q.lesson_id = $1
`;

/**
 * Quiz para o aluno. `is_correct` NUNCA é devolvido — o gabarito fica
 * apenas no servidor e só é revelado depois da tentativa.
 */
export async function getQuizForStudent(lessonId, userId) {
  const lesson = await queryOne(
    `SELECT l.id, l.title, m.course_id, m.title AS "courseTitle"
       FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`,
    [lessonId],
  );
  if (!lesson) throw notFound('Aula não encontrada.');

  await assertEnrolled(userId, lesson.course_id);

  const quiz = await queryOne(quizSelect, [lessonId]);
  if (!quiz) throw notFound('Esta aula não possui quiz.');

  const questions = await queryAll(
    `SELECT qq.id, qq.prompt, qq.explanation, qq.position,
            (SELECT json_agg(json_build_object('id', qo.id, 'label', qo.label)
                             ORDER BY qo.position)
               FROM quiz_options qo WHERE qo.question_id = qq.id) AS options
       FROM quiz_questions qq
      WHERE qq.quiz_id = $1
      ORDER BY qq.position`,
    [quiz.id],
  );

  const attempts = await queryAll(
    `SELECT id, score_percent AS "scorePercent", passed,
            completed_at AS "completedAt", points_awarded AS "pointsAwarded"
       FROM quiz_attempts
      WHERE quiz_id = $1 AND user_id = $2
      ORDER BY completed_at DESC LIMIT 5`,
    [quiz.id, userId],
  );

  const used = attempts.length;
  return {
    ...quiz,
    lessonTitle: lesson.title,
    courseId: lesson.course_id,
    questions: questions.map((q) => ({ ...q, explanation: undefined })),
    attempts,
    attemptsUsed: used,
    attemptsLeft: quiz.maxAttempts > 0 ? Math.max(0, quiz.maxAttempts - used) : null,
    bestScore: attempts.reduce((max, a) => Math.max(max, a.scorePercent), 0),
  };
}

const attemptSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        optionId: z.string().uuid(),
      }),
    )
    .min(1, 'Responda ao menos uma pergunta.'),
});

/**
 * Corrige a tentativa, grava o resultado e credita pontos se aprovado.
 * Idempotente por tentativa (cada envio cria uma nova, o que é intencional).
 */
export async function submitAttempt(lessonId, userId, { answers }) {
  const lesson = await queryOne(
    `SELECT l.id, m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`,
    [lessonId],
  );
  if (!lesson) throw notFound('Aula não encontrada.');
  await assertEnrolled(userId, lesson.course_id);

  const quiz = await queryOne(quizSelect, [lessonId]);
  if (!quiz) throw notFound('Esta aula não possui quiz.');

  const { rows: usedRows } = await query('SELECT count(*)::int AS n FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2', [
    quiz.id,
    userId,
  ]);
  if (quiz.maxAttempts > 0 && usedRows[0].n >= quiz.maxAttempts) {
    throw forbidden('Você esgotou as tentativas disponíveis para este quiz.');
  }

  // Gabarito no servidor.
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a.optionId]));
  const { rows: questions } = await query(
    `SELECT qq.id, qq.explanation,
            (SELECT qo.id FROM quiz_options qo
              WHERE qo.question_id = qq.id AND qo.is_correct = true LIMIT 1) AS "correctOptionId"
       FROM quiz_questions qq WHERE qq.quiz_id = $1`,
    [quiz.id],
  );

  if (questions.length === 0) throw badRequest('Quiz sem perguntas.');

  const correctCount = questions.filter((q) => answerByQuestion.get(q.id) === q.correctOptionId).length;
  const score = Math.round((correctCount / questions.length) * 100);
  const passed = score >= quiz.passPercent;

  // Primeira aprovação do usuário neste quiz.
  const { rows: priorRows } = await query(
    'SELECT 1 FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2 AND passed LIMIT 1',
    [quiz.id, userId],
  );
  const isFirstPass = passed && priorRows.length === 0;

  const { rows } = await query(
    `INSERT INTO quiz_attempts (quiz_id, user_id, score_percent, passed, answers, points_awarded)
     VALUES ($1, $2, $3, $4, $5::jsonb, 0) RETURNING id`,
    [quiz.id, userId, score, passed, JSON.stringify(answers)],
  );
  const attemptId = rows[0].id;

  /*
   * Aprovar um quiz CONCLUI a aula. A aula de quiz não tem duração para medir,
   * então responder certo é a prova — e é o que fecha o curso quando o quiz é a
   * última aula. Fica aqui, e não no `saveLessonProgress`, porque a correção
   * acontece nesta função.
   */
  if (passed) {
    await completeLessonWithoutTime(userId, lessonId);
  }

  let pointsAwarded = 0;
  if (isFirstPass) {
    pointsAwarded = await awardPoints(null, {
      userId,
      points: quiz.pointsReward,
      reason: 'quiz.passed',
      refType: 'quiz_attempt',
      refId: attemptId,
    });
    await query('UPDATE quiz_attempts SET points_awarded = $1 WHERE id = $2', [pointsAwarded, attemptId]);
  }

  const newBadges = passed ? await syncBadges(userId) : [];

  return {
    attemptId,
    scorePercent: score,
    passed,
    correctCount,
    totalQuestions: questions.length,
    pointsAwarded,
    newBadges: newBadges.map((b) => ({ key: b.key, name: b.name, icon: b.icon })),
    // revealed: gabarito liberado só após a tentativa
    questions: questions.map((q) => ({
      id: q.id,
      correctOptionId: q.correctOptionId,
      explanation: q.explanation,
      yourOptionId: answerByQuestion.get(q.id) ?? null,
    })),
  };
}

export async function listQuizzesForCourse(courseId) {
  return queryAll(
    `SELECT q.id, q.lesson_id AS "lessonId", l.title AS "lessonTitle", q.title,
            q.pass_percent AS "passPercent", q.max_attempts AS "maxAttempts"
       FROM quizzes q
       JOIN lessons l ON l.id = q.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1
      ORDER BY m.position, l.position`,
    [courseId],
  );
}
