export type PrizeRank = 1 | 2 | 3 | 4;

export type DrawResult = {
  result_id: string;
  prize_rank: PrizeRank;
  prize_code: string;
  prize_name: string;
  was_existing: boolean;
  drawn_at: string;
  coffee_awarded: boolean;
  coffee_unavailable_reason: 'before_first_delivery' | 'out_of_stock' | null;
  coffee_next_delivery_at: string | null;
  sponsor_included: boolean;
};
