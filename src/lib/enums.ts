/**
 * Central registry of Dataverse option-set (choice) numeric values and their display
 * labels for the AI Champions Hub tables. Choice fields store INTEGERS in Dataverse
 * (see values below); never compare/store the string label. Labels here are the
 * human-friendly text shown in the UI.
 */

// ---- abs_champion ----
export const ChampionRole = {
  Champion: 839560000,
  ProgramManager: 839560001,
} as const;
export const ChampionRoleLabel: Record<number, string> = {
  [ChampionRole.Champion]: 'Champion',
  [ChampionRole.ProgramManager]: 'Program Manager',
};

export const ChampionStatus = {
  Pending: 839560000,
  Active: 839560001,
  Inactive: 839560002,
} as const;
export const ChampionStatusLabel: Record<number, string> = {
  [ChampionStatus.Pending]: 'Pending',
  [ChampionStatus.Active]: 'Active',
  [ChampionStatus.Inactive]: 'Inactive',
};

export const AppMode = {
  Light: 839560000,
  Dark: 839560001,
} as const;

export const FontFamily = {
  Arial: 839560000,
  Calibri: 839560001,
  Roboto: 839560002,
  SegoeUI: 839560003,
  Tahoma: 839560004,
  TimesNewRoman: 839560005,
  Verdana: 839560006,
} as const;
export const FontFamilyStack: Record<number, string> = {
  [FontFamily.Arial]: 'Arial, sans-serif',
  [FontFamily.Calibri]: 'Calibri, "Segoe UI", sans-serif',
  [FontFamily.Roboto]: 'Roboto, "Segoe UI", sans-serif',
  [FontFamily.SegoeUI]: '"Segoe UI", system-ui, sans-serif',
  [FontFamily.Tahoma]: 'Tahoma, sans-serif',
  [FontFamily.TimesNewRoman]: '"Times New Roman", Times, serif',
  [FontFamily.Verdana]: 'Verdana, sans-serif',
};
export const FontFamilyLabel: Record<number, string> = {
  [FontFamily.Arial]: 'Arial',
  [FontFamily.Calibri]: 'Calibri',
  [FontFamily.Roboto]: 'Roboto',
  [FontFamily.SegoeUI]: 'Segoe UI',
  [FontFamily.Tahoma]: 'Tahoma',
  [FontFamily.TimesNewRoman]: 'Times New Roman',
  [FontFamily.Verdana]: 'Verdana',
};

export const FontSize = {
  Large: 839560000,
  Default: 839560001,
  Small: 839560002,
} as const;
export const FontSizeScale: Record<number, string> = {
  [FontSize.Large]: '18px',
  [FontSize.Default]: '16px',
  [FontSize.Small]: '14px',
};
export const FontSizeLabel: Record<number, string> = {
  [FontSize.Large]: 'Larger',
  [FontSize.Default]: 'Default',
  [FontSize.Small]: 'Smaller',
};

// ---- abs_campaign ----
export const CampaignStatus = {
  Draft: 839560000,
  Active: 839560001,
  Completed: 839560002,
} as const;
export const CampaignStatusLabel: Record<number, string> = {
  [CampaignStatus.Draft]: 'Draft',
  [CampaignStatus.Active]: 'Active',
  [CampaignStatus.Completed]: 'Completed',
};

// ---- abs_activity ----
export const ActivityType = {
  OnlineCourse: 839560000,
  LiveSession: 839560001,
  HandsOnLab: 839560002,
  Reading: 839560003,
  Assessment: 839560004,
} as const;
export const ActivityTypeLabel: Record<number, string> = {
  [ActivityType.OnlineCourse]: 'Online Course',
  [ActivityType.LiveSession]: 'Live Session',
  [ActivityType.HandsOnLab]: 'Hands-On Lab',
  [ActivityType.Reading]: 'Reading',
  [ActivityType.Assessment]: 'Assessment',
};

export const ValidationMode = {
  SelfClaimed: 839560000,
  ApprovalRequired: 839560001,
} as const;
export const ValidationModeLabel: Record<number, string> = {
  [ValidationMode.SelfClaimed]: 'Self-Claimed',
  [ValidationMode.ApprovalRequired]: 'Approval Required',
};

// ---- abs_activityclaim ----
export const ClaimStatus = {
  Pending: 839560000,
  Approved: 839560001,
  Rejected: 839560002,
} as const;
export const ClaimStatusLabel: Record<number, string> = {
  [ClaimStatus.Pending]: 'Pending',
  [ClaimStatus.Approved]: 'Approved',
  [ClaimStatus.Rejected]: 'Rejected',
};

// ---- abs_event ----
export const EventFormat = {
  Online: 839560000,
  InPerson: 839560001,
} as const;
export const EventFormatLabel: Record<number, string> = {
  [EventFormat.Online]: 'Online',
  [EventFormat.InPerson]: 'In-Person',
};

// ---- abs_request ----
export const RequestCategory = {
  License: 839560000,
  Connector: 839560001,
  AgentSupport: 839560002,
  DepartmentAISupport: 839560003,
} as const;
export const RequestCategoryLabel: Record<number, string> = {
  [RequestCategory.License]: 'License',
  [RequestCategory.Connector]: 'Connector',
  [RequestCategory.AgentSupport]: 'Agent Support',
  [RequestCategory.DepartmentAISupport]: 'Department AI Support',
};

export const RequestStatus = {
  Open: 839560000,
  InReview: 839560001,
  Approved: 839560002,
  Rejected: 839560003,
  Fulfilled: 839560004,
} as const;
export const RequestStatusLabel: Record<number, string> = {
  [RequestStatus.Open]: 'Open',
  [RequestStatus.InReview]: 'In Review',
  [RequestStatus.Approved]: 'Approved',
  [RequestStatus.Rejected]: 'Rejected',
  [RequestStatus.Fulfilled]: 'Fulfilled',
};

/** Maps a choice label registry to an array of {value,label} for select inputs. */
export function optionsOf(labels: Record<number, string>): { value: number; label: string }[] {
  return Object.keys(labels).map((k) => ({ value: Number(k), label: labels[Number(k)] }));
}
