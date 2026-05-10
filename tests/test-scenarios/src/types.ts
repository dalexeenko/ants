/**
 * Shared test scenario types.
 *
 * Each scenario is a platform-agnostic description of a user flow.
 * Steps can be tagged with `desktop: true` or `mobile: true` inside
 * the action object to indicate they only apply to one platform.
 * Untagged steps apply to both platforms.
 */

export interface Scenario {
  name: string;
  description: string;
  preconditions: Precondition[];
  steps: Step[];
}

export interface Precondition {
  projectExists?: boolean;
}

export type Step = TapStep | TypeStep | AssertVisibleStep | WaitStep;

export interface ActionBase {
  /** Step only applies to desktop (Playwright) */
  desktop?: boolean;
  /** Step only applies to mobile (Maestro) */
  mobile?: boolean;
}

export interface TapStep {
  tap: ActionBase & {
    testId?: string;
    text?: string;
  };
}

export interface TypeStep {
  type: ActionBase & {
    testId?: string;
    text: string;
  };
}

export interface AssertVisibleStep {
  assertVisible: ActionBase & {
    testId?: string;
    text?: string;
  };
}

export interface WaitStep {
  waitForVisible: ActionBase & {
    testId?: string;
    text?: string;
  };
}

export function isTapStep(step: Step): step is TapStep {
  return 'tap' in step;
}

export function isTypeStep(step: Step): step is TypeStep {
  return 'type' in step;
}

export function isAssertVisibleStep(step: Step): step is AssertVisibleStep {
  return 'assertVisible' in step;
}

export function isWaitStep(step: Step): step is WaitStep {
  return 'waitForVisible' in step;
}

/** Get the action object from a step (the inner object with testId/text/platform flags). */
export function getAction(step: Step): ActionBase {
  if (isTapStep(step)) return step.tap;
  if (isTypeStep(step)) return step.type;
  if (isAssertVisibleStep(step)) return step.assertVisible;
  if (isWaitStep(step)) return step.waitForVisible;
  throw new Error('Unknown step type');
}
