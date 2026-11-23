import type { LiveScore } from '../../types';
import { LiveIndicator } from '../ui/LiveIndicator';

function rate(runs: number, overs: number, balls: number) {
  const o = overs + balls / 6;
  return o > 0 ? (runs / o).toFixed(2) : '0.00';
}

/** Live score panel. Cricket shows run rates, partnership and target where the feed provides them. */
export function ScoreCard({ score }: { score: LiveScore }) {
  const c = score.cricket;
  const battingHome = c ? c.battingTeam === score.home.name : false;
  let rrr: string | null = null;
  if (c?.target) {
    const ballsLeft = c.maxOvers * 6 - (c.overs * 6 + c.balls);
    rrr = ballsLeft > 0 ? (((c.target - c.runs) / ballsLeft) * 6).toFixed(2) : '—';
  }
  return (
    <section className="card scorecard" aria-label="Live score">
      <div className="row between">
        {score.status === 'FINISHED' ? <span className="badge">Finished</span> : <LiveIndicator label={score.clock ? `LIVE · ${score.clock}` : 'LIVE'} />}
        <span className="faint" style={{ fontSize: 12 }}>Updated {new Date(score.updatedAt).toLocaleTimeString()}</span>
      </div>
      <div className="score-teams">
        <span className={`team ${c && battingHome ? 'batting' : ''}`}>{score.home.name}</span>
        <span className="score num">{score.home.score}</span>
        <span className={`team ${c && !battingHome ? 'batting' : ''}`}>{score.away.name}</span>
        <span className="score num">{score.away.score}</span>
      </div>
      {c && (
        <div className="cricket-stats">
          <div className="cs"><small>Score</small><b className="num">{c.runs}/{c.wickets}</b></div>
          <div className="cs"><small>Overs</small><b className="num">{c.overs}.{c.balls}</b></div>
          <div className="cs"><small>Run rate</small><b className="num">{rate(c.runs, c.overs, c.balls)}</b></div>
          {rrr && <div className="cs"><small>Req. rate</small><b className="num">{rrr}</b></div>}
          {c.target && <div className="cs"><small>Target</small><b className="num">{c.target}</b></div>}
          <div className="cs"><small>Wickets</small><b className="num">{c.wickets}</b></div>
          <div className="cs"><small>Partnership</small><b className="num">{c.partnership}</b></div>
        </div>
      )}
      {score.timeline.length > 0 && (
        <div className="timeline" aria-label="Live timeline">
          {score.timeline.slice(0, 10).map((t) => (
            <div key={`${t.at}-${t.text}`}><time>{new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{t.text}</div>
          ))}
        </div>
      )}
    </section>
  );
}
