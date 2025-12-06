import React from 'react';
import { ExternalLink, Copy, Check, Square, CheckSquare } from 'lucide-react';

interface MarkdownTextProps {
  content: string;
  className?: string;
}

const MarkdownText: React.FC<MarkdownTextProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split content by code blocks first
  // Capture group 1: language, group 2: code
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Push text before code block
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    // Push code block
    parts.push({ type: 'code', language: match[1], content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  // Push remaining text
  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return (
    <div className={`space-y-3 ${className} text-sm`}>
      {parts.map((part, index) => {
        if (part.type === 'code') {
          return <CodeBlock key={index} language={part.language} code={part.content || ''} />;
        }
        return <RegularText key={index} text={part.content || ''} />;
      })}
    </div>
  );
};

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg overflow-hidden bg-slate-950 border border-slate-800 my-3">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/50 border-b border-slate-800">
        <span className="text-xs text-slate-500 font-mono lowercase">{language || 'text'}</span>
        <button 
          onClick={handleCopy} 
          className="text-slate-500 hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono text-slate-300 leading-relaxed scrollbar-thin">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
};

const RegularText: React.FC<{ text: string }> = ({ text }) => {
  // Split by double newlines for paragraphs
  const paragraphs = text.split(/\n\s*\n/);
  
  return (
    <>
      {paragraphs.map((para, i) => {
         if (!para.trim()) return null;
         
         // Handle Headers and Lists within the paragraph chunk
         // (Simple implementation: split by single newline)
         const lines = para.split('\n');
         
         return (
            <div key={i} className="space-y-1">
                {lines.map((line, j) => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('### ')) return <h3 key={j} className="text-sm font-bold mt-2 text-indigo-200">{parseInline(trimmed.slice(4))}</h3>;
                    if (trimmed.startsWith('## ')) return <h2 key={j} className="text-base font-bold mt-3 border-b border-slate-800 pb-1 text-slate-100">{parseInline(trimmed.slice(3))}</h2>;
                    if (trimmed.startsWith('# ')) return <h1 key={j} className="text-lg font-bold mt-4 mb-2 text-white">{parseInline(trimmed.slice(2))}</h1>;
                    
                    if (trimmed.startsWith('> ')) {
                        return (
                            <div key={j} className="border-l-2 border-indigo-500 pl-3 py-1 text-slate-400 italic bg-slate-800/20 rounded-r">
                                {parseInline(trimmed.slice(2))}
                            </div>
                        );
                    }

                    // Task Lists
                    if (trimmed.match(/^-\s\[ \]\s/)) {
                        return (
                             <div key={j} className="flex gap-2 ml-2 items-start">
                                <Square size={14} className="text-slate-500 mt-0.5 shrink-0" />
                                <span className="flex-1">{parseInline(trimmed.slice(6))}</span>
                             </div>
                        );
                    }
                    if (trimmed.match(/^-\s\[x\]\s/)) {
                        return (
                             <div key={j} className="flex gap-2 ml-2 items-start">
                                <CheckSquare size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                                <span className="flex-1 text-slate-500 line-through">{parseInline(trimmed.slice(6))}</span>
                             </div>
                        );
                    }

                    // Bullet Lists
                    if (trimmed.match(/^[-*]\s/)) {
                         return (
                             <div key={j} className="flex gap-2 ml-2">
                                <span className="text-indigo-500 font-bold mt-1.5 text-[10px]">•</span>
                                <span className="flex-1">{parseInline(trimmed.slice(2))}</span>
                             </div>
                         );
                    }

                    // Numbered Lists
                    if (trimmed.match(/^\d+\.\s/)) {
                        const match = trimmed.match(/^(\d+)\.\s/);
                        const num = match ? match[1] : '1';
                        return (
                             <div key={j} className="flex gap-2 ml-2">
                                <span className="text-slate-500 font-mono text-xs mt-0.5">{num}.</span>
                                <span className="flex-1">{parseInline(trimmed.replace(/^\d+\.\s/, ''))}</span>
                             </div>
                        );
                    }

                    return <p key={j} className="leading-relaxed whitespace-pre-wrap">{parseInline(line)}</p>;
                })}
            </div>
         );
      })}
    </>
  );
};

const parseInline = (text: string): React.ReactNode => {
    // Regex for:
    // 1. Bold: **text**
    // 2. Italic: *text*
    // 3. Code: `text`
    // 4. Link: [text](url)
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;
    const parts = text.split(regex);
    
    return parts.map((part, idx) => {
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={idx} className="font-semibold text-indigo-200">{part.slice(2, -2)}</strong>;
        }
        // Italic
        if (part.startsWith('*') && part.endsWith('*')) {
            return <em key={idx} className="italic text-slate-400">{part.slice(1, -1)}</em>;
        }
        // Code
        if (part.startsWith('`') && part.endsWith('`')) {
            return <code key={idx} className="bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded font-mono text-xs border border-slate-700/50">{part.slice(1, -1)}</code>;
        }
        // Link
        if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
            const match = part.match(/\[(.*?)\]\((.*?)\)/);
            if (match) {
                return (
                    <a 
                        key={idx} 
                        href={match[2]} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-0.5 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {match[1]} <ExternalLink size={10} />
                    </a>
                );
            }
        }
        return part;
    });
};

export default MarkdownText;