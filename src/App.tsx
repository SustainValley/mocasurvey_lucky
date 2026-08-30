import { FormEvent, useEffect, useRef, useState } from 'react';
import { figmaAssets } from './lib/figmaAssets';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import type { DrawResult, PrizeRank } from './types';

const PRIZE_META: Record<PrizeRank, { label: string; name: string }> = {
  1: { label: '1등', name: '진커피 · 망고산도' },
  2: { label: '2등', name: '이치제과 · 플레인 베이글' },
  3: { label: '3등', name: '버터떡' },
  4: { label: '4등', name: '컴포즈커피 아메리카노' },
};

const BALLS = [
  { src: figmaAssets.ball1, className: 'ball ball-1' },
  { src: figmaAssets.ball2, className: 'ball ball-2' },
  { src: figmaAssets.ball3, className: 'ball ball-3' },
  { src: figmaAssets.ball4, className: 'ball ball-4' },
  { src: figmaAssets.ball5, className: 'ball ball-5' },
  { src: figmaAssets.ball6, className: 'ball ball-6' },
  { src: figmaAssets.ball7, className: 'ball ball-7' },
  { src: figmaAssets.ball8, className: 'ball ball-8' },
  { src: figmaAssets.ball9, className: 'ball ball-9' },
  { src: figmaAssets.ball10, className: 'ball ball-10' },
  { src: figmaAssets.ball11, className: 'ball ball-11' },
];

type Screen = 'login' | 'draw';
type DrawPhase = 'idle' | 'drawing' | 'revealing' | 'result' | 'error';

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [studentId, setStudentId] = useState('');
  const [studentIdInput, setStudentIdInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [phase, setPhase] = useState<DrawPhase>('idle');
  const [result, setResult] = useState<DrawResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const drawLock = useRef(false);

  function resetForNextParticipant() {
    setScreen('login');
    setStudentId('');
    setStudentIdInput('');
    setLoginError('');
    setPhase('idle');
    setResult(null);
    setErrorMessage('');
    drawLock.current = false;
  }

  useEffect(() => {
    if (phase !== 'result') return;

    // 행사장 공용 화면: 별도 버튼 없이 결과를 충분히 보여준 뒤
    // 자동으로 다음 참여자의 학번 입력 화면으로 돌아갑니다.
    const timer = window.setTimeout(() => {
      resetForNextParticipant();
    }, 9000);

    return () => window.clearTimeout(timer);
  }, [phase]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = studentIdInput.replace(/\D/g, '').trim();

    if (normalized.length < 6 || normalized.length > 10) {
      setLoginError('학번을 다시 확인해 주세요.');
      return;
    }

    if (!hasSupabaseConfig || !supabase) {
      setLoginError('행사 시스템 연결을 확인해 주세요.');
      return;
    }

    setLoginError('참여 여부를 확인하고 있어요.');

    const { data, error } = await supabase.rpc('check_lucky_draw_eligibility', {
      p_student_id: normalized,
    });

    if (error) {
      console.error('[Lucky Draw Eligibility]', error.message);
      setLoginError('참여 정보를 확인하지 못했어요. 운영진에게 문의해 주세요.');
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.eligible) {
      setLoginError(normalizeEligibilityReason(row?.reason));
      return;
    }

    setStudentId(normalized);
    setStudentIdInput(normalized);
    setLoginError('');
    setPhase('idle');
    setResult(null);
    setErrorMessage('');
    drawLock.current = false;
    setScreen('draw');
  }

  async function draw() {
    if (drawLock.current || phase !== 'idle') return;

    if (!studentId) {
      setScreen('login');
      return;
    }

    if (!hasSupabaseConfig || !supabase) {
      setErrorMessage('행사 시스템 연결을 확인해 주세요.');
      setPhase('error');
      return;
    }

    drawLock.current = true;
    setErrorMessage('');
    setPhase('drawing');

    // 손잡이/캡슐 모션과 Twirl cover가 끝날 때까지 결과를 노출하지 않습니다.
    const minimumCover = new Promise((resolve) => setTimeout(resolve, 1120));

    try {
      const request = supabase.rpc('draw_lucky_prize', {
        p_student_id: studentId,
      });

      const [{ data, error }] = await Promise.all([request, minimumCover]);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('당첨 결과가 비어 있습니다.');

      setResult(row as DrawResult);
      setPhase('revealing');

      window.setTimeout(() => setPhase('result'), 850);
    } catch (error) {
      const message = error instanceof Error ? error.message : '럭키드로우 처리 중 오류가 발생했습니다.';
      console.error('[Lucky Draw]', message);
      setErrorMessage(normalizeError(message));
      setPhase('error');
      drawLock.current = false;
    }
  }

  function closeError() {
    setPhase('idle');
    setErrorMessage('');
    drawLock.current = false;
  }

  const prize = result ? PRIZE_META[result.prize_rank] : null;

  return (
    <main className="page-shell">
      <section className="lucky-stage" aria-label="CAFE MOCA 럭키드로우">
        {screen === 'login' ? (
          <LoginScreen
            studentId={studentIdInput}
            error={loginError}
            onStudentIdChange={(value) => {
              setStudentIdInput(value.replace(/\D/g, '').slice(0, 10));
              if (loginError) setLoginError('');
            }}
            onSubmit={login}
          />
        ) : (
          <>
            <button type="button" className="change-student" onClick={resetForNextParticipant}>
              학번 변경
            </button>

            <div className={`gacha ${phase === 'drawing' ? 'gacha-drawing' : ''}`} aria-hidden="true">
              {BALLS.map((ball, index) => (
                <img key={index} src={ball.src} className={ball.className} alt="" draggable={false} />
              ))}
              <img className="machine" src={figmaAssets.machine} alt="" draggable={false} />
              <img
                className={`handle ${phase === 'drawing' ? 'handle-spinning' : ''}`}
                src={figmaAssets.handle}
                alt=""
                draggable={false}
              />
            </div>

            <div className="pink-gradient" aria-hidden="true" />

            <button
              type="button"
              className="cta"
              onClick={draw}
              disabled={phase !== 'idle'}
              aria-busy={phase === 'drawing' || phase === 'revealing'}
            >
              {phase === 'drawing' || phase === 'revealing' ? 'Lucky...' : 'Lucky you!'}
            </button>

            {(phase === 'revealing' || phase === 'result') && result && prize && (
              <ResultScreen result={result} prize={prize} />
            )}

            {(phase === 'drawing' || phase === 'revealing') && (
              <TwirlTransition mode={phase === 'drawing' ? 'cover' : 'reveal'} />
            )}

            {phase === 'error' && (
              <div className="result-layer error-layer" role="alertdialog" aria-modal="true">
                <div className="result-card error-card">
                  <p className="result-kicker">LUCKY DRAW</p>
                  <h1>잠시 확인해 주세요</h1>
                  <p className="result-help">{errorMessage}</p>
                  <button type="button" className="retry-button" onClick={closeError}>
                    다시 시도
                  </button>
                  <button type="button" className="secondary-button" onClick={resetForNextParticipant}>
                    학번 다시 입력
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function LoginScreen({
  studentId,
  error,
  onStudentIdChange,
  onSubmit,
}: {
  studentId: string;
  error: string;
  onStudentIdChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="login-screen refined-login">
      <div className="login-grid" aria-hidden="true" />

      <header className="moca-header">
        <div className="moca-brand" aria-label="Cafe Moca">
          <span className="moca-brand-cafe">Cafe</span>
          <span className="moca-brand-moca">Moca</span>
        </div>
        <span className="moca-header-caption">OFFLINE LUCKY DRAW</span>
        <span className="moca-header-pill">CAFE MOCA POP-UP</span>
      </header>

      <div className="login-app-shell simple-login-shell">
        <div className="simple-login-copy">
          <p className="login-hero-kicker">오늘의 CAFE MOCA</p>
          <h1>럭키드로우에 참여해볼까요?</h1>
          <p className="login-hero-description">
            온라인 설문과 오프라인 부스 참여를<br />모두 완료한 학우만 참여할 수 있어요.
          </p>
        </div>

        <form className="login-panel simple-login-panel" onSubmit={onSubmit}>
          <p className="login-panel-kicker">참여 확인</p>
          <h2>학번을 입력해주세요.</h2>
          <p className="login-panel-description">참여 완료 여부를 확인한 뒤 럭키드로우가 시작돼요.</p>

          <label className="student-label" htmlFor="student-id">학번</label>
          <input
            id="student-id"
            className={`student-input ${error && !error.includes('확인하고') ? 'student-input-error' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="학번 (ex.2026000000)"
            value={studentId}
            onChange={(event) => onStudentIdChange(event.target.value)}
            aria-invalid={Boolean(error && !error.includes('확인하고'))}
            aria-describedby={error ? 'student-error' : undefined}
          />

          <div className="login-message-row">
            {error ? <p id="student-error" className={error.includes('확인하고') ? 'student-checking' : 'student-error'}>{error}</p> : <span />}
          </div>

          <button className="login-button" type="submit" disabled={!studentId.trim() || error.includes('확인하고')}>
            참여 확인하기 <span aria-hidden="true">→</span>
          </button>
          <p className="login-note">온라인 + 오프라인 참여 완료 학번만 입장할 수 있어요.</p>
        </form>
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  prize,
}: {
  result: DrawResult;
  prize: { label: string; name: string };
}) {
  return (
    <div className="result-layer result-layer-prize" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <img className="result-bean result-bean-1" src={figmaAssets.bean1} alt="" draggable={false} aria-hidden="true" />
      <img className="result-bean result-bean-2" src={figmaAssets.bean2} alt="" draggable={false} aria-hidden="true" />
      <img className="result-bean result-bean-3" src={figmaAssets.bean3} alt="" draggable={false} aria-hidden="true" />

      <div className="result-decoration" aria-hidden="true">
        <img src={figmaAssets.transitionStar} alt="" draggable={false} />
      </div>

      <div className="result-card result-card-prize">
        <p className="result-kicker">CAFE MOCA · LUCKY DRAW</p>
        <p className="result-celebrate">LUCKY YOU!</p>
        <h1 id="result-title">{prize.label} 당첨!</h1>
        <p className="result-prize">{result.prize_name || prize.name}</p>
      </div>
    </div>
  );
}

function TwirlTransition({ mode }: { mode: 'cover' | 'reveal' }) {
  return (
    <div className={`twirl-transition twirl-${mode}`} aria-hidden="true">
      <img className="twirl-star twirl-star-back" src={figmaAssets.transitionStar} alt="" draggable={false} />
      <img className="twirl-star twirl-star-main" src={figmaAssets.transitionStar} alt="" draggable={false} />
    </div>
  );
}

function normalizeEligibilityReason(reason?: string) {
  switch (reason) {
    case 'INVALID_STUDENT_ID':
      return '학번을 다시 확인해 주세요.';
    case 'NOT_REGISTERED_PARTICIPANT':
      return '참가자 명단에 없는 학번이에요. 먼저 온라인 설문에 참여해 주세요.';
    case 'ONLINE_NOT_COMPLETED':
      return '온라인 설문을 완료한 뒤 참여할 수 있어요.';
    case 'OFFLINE_NOT_COMPLETED':
      return '오프라인 부스 참여 확인이 필요해요. 운영진에게 참여 확인을 요청해 주세요.';
    default:
      return '참여 정보를 확인할 수 없어요. 운영진에게 문의해 주세요.';
  }
}

function normalizeError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('invalid_student_id') || lower.includes('invalid student id')) return '학번을 다시 확인해 주세요.';
  if (lower.includes('not_registered_participant')) return '참가자 명단에 없는 학번이에요.';
  if (lower.includes('online_not_completed')) return '온라인 설문을 완료한 뒤 참여할 수 있어요.';
  if (lower.includes('offline_not_completed')) return '오프라인 부스 참여 확인이 필요해요. 운영진에게 문의해 주세요.';
  if (lower.includes('sold out') || lower.includes('no prize')) return '준비된 럭키드로우 상품이 모두 소진되었습니다.';
  return message;
}
