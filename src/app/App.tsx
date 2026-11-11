import React, { useEffect } from 'react';
import { SetupPanel } from '@/components/SetupPanel';
import { AvatarStage } from '@/components/AvatarStage';
import { ConversationBar } from '@/components/ConversationBar';
import { useSessionStore } from '@/store/session';
import { normalizePath, syncUrlWithStage } from '@/app/routes';
import { ShieldCheck, Bug, Sparkles, Settings, User } from 'lucide-react';

export const App: React.FC = () => {
  const {
    stage,
    setStage,
    faceLandmarks,
    characterName,
    apiKey,
    isDebugOverlay,
    setIsDebugOverlay,
    errorMessage,
    setErrorMessage,
  } = useSessionStore();

  const canGoToAvatar = Boolean(
    faceLandmarks &&
      faceLandmarks.length > 0 &&
      characterName.trim().length > 0 &&
      apiKey.trim().length > 0
  );

  // Sincronización y manejo del enrutamiento estático (/settings y /avatar)
  useEffect(() => {
    const currentPath = normalizePath(window.location.pathname);
    if (currentPath === '/avatar') {
      const state = useSessionStore.getState();
      const hasReady = Boolean(
        state.faceLandmarks &&
          state.faceLandmarks.length > 0 &&
          state.characterName.trim().length > 0 &&
          state.apiKey.trim().length > 0
      );
      if (!hasReady) {
        // Redirigir a /settings si faltan foto, nombre o API key
        setStage('setup');
        syncUrlWithStage('setup', true);
      } else {
        setStage('avatar');
        syncUrlWithStage('avatar', true);
      }
    } else {
      setStage('setup');
      syncUrlWithStage('setup', true);
    }

    const handlePopState = () => {
      const path = normalizePath(window.location.pathname);
      if (path === '/avatar') {
        const state = useSessionStore.getState();
        const hasReady = Boolean(
          state.faceLandmarks &&
            state.faceLandmarks.length > 0 &&
            state.characterName.trim().length > 0 &&
            state.apiKey.trim().length > 0
        );
        if (!hasReady) {
          setStage('setup');
          syncUrlWithStage('setup', true);
        } else {
          setStage('avatar');
        }
      } else {
        setStage('setup');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setStage]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Barra de Navegación / Encabezado */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStage('setup')}
              className="flex items-center gap-3 group cursor-pointer text-left focus:outline-hidden transition-opacity hover:opacity-90 active:scale-95 transition-transform"
              title="Ir a Ajustes / Página Principal"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 group-hover:shadow-indigo-500/40 group-hover:scale-105 transition-all">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-lg tracking-tight text-white group-hover:text-indigo-200 transition-colors">
                Your<span className="text-indigo-400">Self</span>
              </span>
            </button>

            {/* Pestañas de Enrutamiento Fijo (/settings <-> /avatar) */}
            <nav className="flex items-center gap-1 ml-4 bg-slate-900/90 border border-slate-800 p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setStage('setup')}
                className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                  stage === 'setup'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Ruta /settings"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Ajustes</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (canGoToAvatar) {
                    setStage('avatar');
                  }
                }}
                disabled={!canGoToAvatar}
                className={`px-3 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                  stage === 'avatar'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : !canGoToAvatar
                      ? 'text-slate-600 cursor-not-allowed opacity-40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer'
                }`}
                title={
                  !canGoToAvatar
                    ? 'Completa la foto, nombre del personaje y API key en Ajustes para activar el avatar (/avatar)'
                    : 'Ir al Avatar (/avatar)'
                }
              >
                <User className="w-3.5 h-3.5" />
                <span>Avatar</span>
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-1 rounded-full">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacidad Local · Sin Servidores</span>
            </div>

            {/* Toggle de depuración (?debug=1) */}
            <button
              onClick={() => setIsDebugOverlay(!isDebugOverlay)}
              className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
                isDebugOverlay
                  ? 'border-indigo-500 bg-indigo-950 text-indigo-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Activar/desactivar overlay de depuración de malla"
            >
              <Bug className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium hidden sm:inline">
                {isDebugOverlay ? 'Debug: ON' : 'Debug'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Banner de Error Global */}
      {errorMessage && (
        <div className="bg-rose-950 border-b border-rose-800 text-rose-200 px-4 py-2.5 text-xs flex items-center justify-between">
          <div className="max-w-4xl mx-auto flex items-center justify-between w-full">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-400 hover:text-rose-100 font-bold ml-4 cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <main className="flex-1 flex flex-col justify-start items-center py-2 sm:py-4">
        {stage === 'setup' ? (
          <SetupPanel />
        ) : (
          <div className="w-full max-w-[540px] px-3 flex flex-col items-center gap-3">
            <AvatarStage />
            <ConversationBar />
          </div>
        )}
      </main>

      {/* Pie de Página */}
      <footer className="border-t border-slate-900/80 py-4 text-center text-xs text-slate-500">
        <p>
          YourSelf · Renderizado WebGL reactivo con Three.js y MediaPipe FaceLandmarker · Gemini Multimodal Live API
        </p>
      </footer>
    </div>
  );
};

export default App;
