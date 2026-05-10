import { z } from "zod";
import { defineTool, generateId } from "@openmgr/agent-core";
import type { QuestionResponse } from "@openmgr/agent-core";

const DESCRIPTION = `Present a question to the user with selectable options.

Use this tool when you need the user to make a choice or provide input from a set of options.
This is better than asking the user to type a response, because it gives them clickable/selectable options.

## Modes

- **Single select** (multiple: false): User picks exactly one option.
- **Multi select** (multiple: true): User can pick one or more options.

The user can always type a freeform response instead of selecting from the options.

## When to Use

- Clarifying ambiguous requirements (e.g., "Which framework do you prefer?")
- Offering implementation choices (e.g., "Should I use approach A or B?")
- Confirming actions before proceeding (e.g., "Which files should I modify?")
- Gathering preferences (e.g., "What testing library do you want?")

## When NOT to Use

- When there is only one obvious path forward
- When you need detailed, open-ended information from the user
- For yes/no questions - just ask in your message text instead`;

const QuestionOptionSchema = z.object({
  label: z.string().describe("Short display text for the option (1-5 words)"),
  description: z.string().optional().describe("Longer explanation of what this option means"),
});

export const questionTool = defineTool({
  name: "question",
  description: DESCRIPTION,
  parameters: z.object({
    question: z.string().describe("The question to present to the user"),
    options: z.array(QuestionOptionSchema).min(2).describe("The options to choose from (minimum 2)"),
    multiple: z.boolean().default(false).describe("If true, user can select multiple options. If false, user picks exactly one."),
  }),
  async execute(params, ctx) {
    const agent = ctx.getAgent?.() as {
      registerQuestionResolver(id: string, resolver: (response: QuestionResponse) => void): void;
    } | undefined;

    if (!agent || !ctx.emitEvent) {
      return {
        output: "Question functionality not available in this context.",
        metadata: { error: true },
      };
    }

    const questionId = generateId();

    // Emit the question event so frontends can render the UI
    ctx.emitEvent({
      type: "question.request",
      questionId,
      messageId: ctx.messageId ?? "",
      question: params.question,
      options: params.options,
      multiple: params.multiple ?? false,
      allowFreeform: true as const,
    });

    // Block until the user responds
    const response = await new Promise<QuestionResponse>((resolve) => {
      agent.registerQuestionResolver(questionId, resolve);
    });

    // Format the result for the LLM
    if (response.freeformText) {
      return {
        output: `User responded with freeform text: "${response.freeformText}"`,
        metadata: {
          questionId,
          freeformText: response.freeformText,
        },
      };
    }

    const selectedLabels = response.selected;
    if (selectedLabels.length === 0) {
      return {
        output: "User did not select any option.",
        metadata: { questionId, selected: [] },
      };
    }

    if (selectedLabels.length === 1) {
      return {
        output: `User selected: "${selectedLabels[0]}"`,
        metadata: { questionId, selected: selectedLabels },
      };
    }

    return {
      output: `User selected: ${selectedLabels.map((l) => `"${l}"`).join(", ")}`,
      metadata: { questionId, selected: selectedLabels },
    };
  },
});
