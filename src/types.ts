export type PrizeRank = 1 | 2 | 3 | 4;

export type DrawResult = {
  result_id: string;
  prize_rank: PrizeRank;
  prize_code: string;
  prize_name: string;
  was_existing: boolean;
  drawn_at: string;
};
