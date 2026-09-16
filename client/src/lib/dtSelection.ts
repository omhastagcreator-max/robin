/**
 * Decision Tree gating — the single source of DT unlocking.
 * The CRM page writes the selected workflow id here; the Decision Tree
 * page refuses to render its workspace until a value is present.
 */
export const DT_SELECTED_KEY = 'robin.dt.selectedWorkflowId';
