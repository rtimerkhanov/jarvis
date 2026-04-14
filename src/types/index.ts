export type ActionType =
  | 'food_photo'
  | 'food_text'
  | 'notebook_morning'
  | 'notebook_evening'
  | 'journal_free'
  | 'journal_therapy'
  | 'supplement'
  | 'recipe_query'
  | 'time_entry'
  | 'pending_answer'
  | 'ask_clarification';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type JournalEntryType = 'free' | 'therapy';

export interface NutritionData {
  description: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface NotebookData {
  section: 'morning' | 'evening';
  checkboxes: Record<string, boolean>;
  metrics: Record<string, number | string>;
  text_fields: Record<string, string>;
  substances: Array<{
    substance: string;
    time_taken?: string;
    dose?: string;
    reason?: string;
  }>;
  raw_parsed: Record<string, unknown>;
}

export interface ConversationMessage {
  role: 'user' | 'bot';
  type: ActionType | 'bot_question';
  text?: string;
  has_photo?: boolean;
  timestamp: string;
}

export interface PendingQuestion {
  type: 'blind_spot' | 'clarification' | 'meal_type';
  context: Record<string, unknown>;
}
