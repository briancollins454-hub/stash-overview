
import React, { useState, useEffect, useRef } from 'react';
import { UnifiedOrder, ChatMessage } from '../types';
import { analyzeBusinessData } from '../services/geminiService';
import { Send, Bot, User, Loader2 } from 'lucide-react';

interface ProcessAnalystProps {
  orders: UnifiedOrder[];
}

const ProcessAnalyst: React.FC<ProcessAnalystProps> = ({ orders }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: "Hello! I'm your Stash Shop Analyst. I can help you spot late orders, OR I can help you design the integration between Shopify and DecoNetwork. What would you like to do?",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || input;
    if (!textToSend.trim()) return;

    const userMsg: ChatMessage = { role: 'user', text: textToSend, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Prepare simple history for context
    const historyForApi = messages.map(m => ({role: m.role, text: m.text}));
    
    const responseText = await analyzeBusinessData(orders, textToSend, historyForApi);
    
    setLoading(false);
    setMessages(prev => [...prev, { role: 'model', text: responseText, timestamp: Date.now() }]);
  };

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-lg">
            <Bot className="text-white w-6 h-6" />
          </div>
          <div>
            <h3 className="text-white font-bold">Process Analyst AI</h3>
            {/* Fix: Updated model name in UI label for consistency */}
            <p className="text-indigo-100 text-xs">Powered by Gemini 3 Pro</p>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none'
                  : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'
              }`}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 rounded-bl-none flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span className="text-xs text-gray-500">Analyzing production data...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask specific questions or start an interview..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
          />
          <button
            onClick={() => handleSend()}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
             <button onClick={() => handleSend("I want to set up the connection. Interview me.")} className="whitespace-nowrap text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium px-3 py-1 rounded-full transition-colors border border-indigo-200">
                 Start Discovery Interview
             </button>
             <button onClick={() => handleSend("Which orders are late?")} className="whitespace-nowrap text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1 rounded-full transition-colors">
                 Which orders are late?
             </button>
             <button onClick={() => handleSend("Draft an email for Order 1002 about delay")} className="whitespace-nowrap text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1 rounded-full transition-colors">
                 Draft delay email
             </button>
        </div>
      </div>
    </div>
  );
};

export default ProcessAnalyst;
