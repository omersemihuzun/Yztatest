import React, { useEffect, useState } from 'react';
import { BookOpen, Video, MessageSquare, Trash2 } from 'lucide-react';

const Sidebar = ({ onSourceSelect, onGraphRefresh }) => {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSources = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8080/api/v1/sources');
      const data = await response.json();
      setSources(data);
    } catch (err) {
      console.error("Kaynaklar yuklenemedi", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleDelete = async (e, sessionId) => {
    e.stopPropagation(); // Kartın seçilmesini (onSourceSelect) engelle
    if (!window.confirm("Bu kaynağı ve ona bağlı olan tüm kavramları silmek istediğine emin misin?")) return;

    try {
      const res = await fetch(`http://127.0.0.1:8080/api/v1/sources/${sessionId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        // Kaynağı sil ve listeyi güncelle
        await fetchSources();
        if (onGraphRefresh) {
          onGraphRefresh(); // Haritayı da yenile ki silinen nodelar gitsin
        }
      }
    } catch (err) {
      console.error("Silme hatası:", err);
    }
  };

  const getIcon = (platform) => {
    if (platform === 'YouTube') return <Video size={16} style={{ color: '#ff5252' }} />;
    return <MessageSquare size={16} style={{ color: '#03dac6' }} />;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="sidebar glass-panel">
      <div className="sidebar-header">
        <h2 className="title-glow" style={{ fontSize: '1.2rem' }}>Öğrenme Kaynakları</h2>
      </div>
      <div className="source-list">
        {loading ? (
          <p className="loading-text">Yükleniyor...</p>
        ) : (
          sources.map((src) => (
            <div 
              key={src.id} 
              className="source-item"
              onClick={() => onSourceSelect(src)}
            >
              <div className="source-icon">
                {getIcon(src.platform)}
              </div>
              <div className="source-content" style={{ flex: 1, paddingRight: '10px' }}>
                <p className="source-title" title={src.title}>{src.title}</p>
                <span className="source-date">{formatDate(src.date)}</span>
              </div>
              <button 
                className="delete-source-btn" 
                onClick={(e) => handleDelete(e, src.id)}
                title="Kaynağı Sil"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Sidebar;
