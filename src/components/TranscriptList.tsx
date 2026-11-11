import React from 'react';
import { useSessionStore } from '@/store/session';
import { User, Sparkles, MessageSquare } from 'lucide-react';

export const TranscriptList: React.FC = () => {
  const { transcripts, characterName } = useSessionStore();

  if (transcripts.length === 0) {
    return (
      <div className="w-full max-w-xl mx-auto p-3.5 text-center text-xs text-slate-500 bg-slate-950/40 rounded-xl border border-slate-900 flex items-center justify-center gap-2">
        <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
        <span>Las transcripciones de la conversación por voz aparecerán aquí en tiempo real...</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto max-h-52 overflow-y-auto space-y-2.5 p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800/80 shadow-inner">
      {transcripts.map((msg) => {
        const isUser = msg.role === 'user';
        return (
          <div
            key={msg.id}
            className={`flex flex-col text-xs ${isUser ? 'items-end' : 'items-start'}`}
          >
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1 px-1">
              {isUser ? (
                <>
                  <span className="font-semibold text-slate-300">Tú</span>
                  <User className="w-3 h-3 text-indigo-400" />
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  <span className="font-semibold text-purple-300">
                    {characterName || 'Avatar'}
                  </span>
                </>
              )}
            </div>
            <div
              className={`max-w-[85%] px-3.5 py-2 rounded-2xl leading-relaxed shadow-sm ${
                isUser
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : 'bg-slate-800/90 text-slate-100 rounded-tl-none border border-slate-700/60'
              }`}
            >
              {msg.text}
              {msg.isStreaming && (
                <span className="inline-block w-1.5 h-3 ml-1 bg-indigo-400 animate-pulse align-middle" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
