import { Activity, Bike, CircleDot, Disc3, Flag, Gamepad2, Goal, Hand, Snowflake, Swords, Target, Trophy, Volleyball, type LucideProps } from 'lucide-react';

const MAP: Record<string, React.ComponentType<LucideProps>> = {
  cricket: Target, football: Goal, tennis: CircleDot, basketball: Disc3, baseball: Activity, 'ice-hockey': Snowflake, volleyball: Volleyball,
  rugby: Hand, golf: Flag, boxing: Swords, mma: Swords, 'horse-racing': Bike, esports: Gamepad2,
};

export function SportIcon({ slug, size = 18 }: { slug: string; size?: number }) {
  const Icon = MAP[slug] ?? Trophy;
  return <Icon size={size} aria-hidden />;
}
