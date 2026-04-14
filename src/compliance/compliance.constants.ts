/**
 * PRD v1.1 §11.1 — call hours are evaluated in Pakistan Standard Time (PKT, IANA `Asia/Karachi`).
 * Inclusive local hour band: 09–20 (9 AM through 8 PM).
 */
export const PRD_CALL_WINDOW_TIMEZONE = 'Asia/Karachi' as const;
export const PRD_CALL_WINDOW_START_HOUR_PKT = 9;
export const PRD_CALL_WINDOW_END_HOUR_PKT = 20;
