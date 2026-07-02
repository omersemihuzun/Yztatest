import React, { useState, useEffect } from 'react';
import MindMap from './components/MindMap';
import NodeDetailsPanel from './components/NodeDetailsPanel';
import Sidebar from './components/Sidebar';
import ChatBar from './components/ChatBar';

function App() {
  const [fullGraphData, setFullGraphData] = useState({ nodes: [], edges: [] });
  const [displayGraph, setDisplayGraph] = useState({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSource, setActiveSource] = useState(null);

  const fetchGraph = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8080/api/v1/graph');
      const data = await response.json();
      setFullGraphData(data);
      setDisplayGraph(data);
    } catch (error) {
      console.error("Zihin haritasi yuklenemedi:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraph();
  }, []);

  const handleSourceSelect = (source) => {
    setActiveSource(source);
    // Kaynağa göre filtrele
    const filteredNodes = fullGraphData.nodes.filter(n => 
      n.sources && n.sources.some(url => url.includes(source.url))
    );
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = fullGraphData.edges.filter(e => 
      nodeIds.has(e.source) && nodeIds.has(e.target)
    );
    setDisplayGraph({ nodes: filteredNodes, edges: filteredEdges });
  };

  const handleSearch = (query) => {
    const term = query.toLowerCase();
    const foundNode = displayGraph.nodes.find(n => n.label.toLowerCase().includes(term));
    if (foundNode) {
      setSelectedNode(foundNode);
    }
  };

  const handleReset = () => {
    setActiveSource(null);
    setDisplayGraph(fullGraphData);
  };

  return (
    <div className="app-container notebook-layout">
      {/* Sol Panel: Kaynaklar */}
      <Sidebar onSourceSelect={handleSourceSelect} onGraphRefresh={fetchGraph} />

      <div className="main-content">
        <div className="header glass-panel" style={{ padding: '20px 30px', margin: '24px', width: 'max-content', position: 'absolute', zIndex: 10 }}>
          <h1 className="title-glow" style={{ cursor: 'pointer' }} onClick={handleReset}>
            Living Mind Tree
          </h1>
          <p>
            {activeSource ? `Filtre: ${activeSource.title}` : 'Tüm Kişisel Öğrenme Ağı'}
          </p>
        </div>

        {/* Merkez Graf */}
        <div className="graph-wrapper" style={{ flex: 1, position: 'relative' }}>
          {!loading && (
            <MindMap 
              data={displayGraph} 
              onNodeClick={(node) => setSelectedNode(node)} 
            />
          )}
        </div>

        {/* Alt Panel: RAG Chat */}
        <ChatBar onSearch={handleSearch} />
      </div>

      {/* Sağ Panel: Node Detayları (Absolute over the canvas) */}
      <NodeDetailsPanel 
        node={selectedNode} 
        onClose={() => setSelectedNode(null)} 
      />
    </div>
  );
}

export default App;
