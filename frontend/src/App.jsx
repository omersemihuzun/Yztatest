import React, { useState, useEffect, useRef } from 'react';
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
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0);
  const [focusCluster, setFocusCluster] = useState(null);
  const [isClusteringMode, setIsClusteringMode] = useState(false); // Varsayılan olarak klasik açık görünüm

  // Dosya seçici için referans
  const fileInputRef = useRef(null);

  const fetchGraph = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8080/api/v1/graph');
      const data = await response.json();
      setFullGraphData(data);
      // useEffect derived state handle edecek
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
    setZoomToFitTrigger(prev => prev + 1);
  };

  const handleSearch = (query) => {
    const term = query.toLowerCase();
    // Arama yaparken eğer kavram gizliyse açmak için kümesini bul
    const foundNode = fullGraphData.nodes.find(n => n.label.toLowerCase().includes(term));
    if (foundNode) {
      const cid = foundNode.cluster_id || 'Genel';
      setExpandedClusters(prev => {
        const next = new Set(prev);
        next.add(cid);
        return next;
      });
      // Biraz bekle graf render olsun, sonra seç
      setTimeout(() => setSelectedNode(foundNode), 100);
    }
  };

  const handleReset = () => {
    setActiveSource(null);
    setExpandedClusters(new Set());
    setFocusCluster(null);
    setIsClusteringMode(false); // Sıfırlayınca klasik görünüme dön
    setZoomToFitTrigger(prev => prev + 1);
  };

  const handleCollapseAll = () => {
    setExpandedClusters(new Set());
    setFocusCluster(null);
    setZoomToFitTrigger(prev => prev + 1);
  };

  const allClusters = React.useMemo(() => {
    const map = {};
    fullGraphData.nodes.forEach(n => {
      const cid = n.cluster_id || 'Genel';
      if (!map[cid]) map[cid] = { id: cid, count: 0, p_sum: 0, p_count: 0 };
      map[cid].count++;
      if (typeof n.fsrs_p === 'number') {
        map[cid].p_sum += n.fsrs_p;
        map[cid].p_count++;
      }
    });
    return Object.values(map).map(c => ({
      id: c.id,
      count: c.count,
      avg_p: c.p_count > 0 ? c.p_sum / c.p_count : null
    })).sort((a, b) => b.count - a.count); // En çok kavram içeren küme en üstte
  }, [fullGraphData]);

  const handleClusterSelect = (clusterId) => {
    // Kümeler menüsünden tıklanınca kümeleme modunu otomatik aç ve odaklan
    setIsClusteringMode(true);
    setFocusCluster({ id: clusterId, t: Date.now() });

    // Seçilen kümenin kendisini ve geriye dönük tüm atalarını (ancestors) bul
    const ancestors = new Set([clusterId]);
    let currentId = clusterId;
    const visited = new Set();

    while (currentId) {
      if (visited.has(currentId)) break; // Sonsuz döngü koruması
      visited.add(currentId);

      const node = fullGraphData.nodes.find(n => n.id === currentId);
      if (node && node.cluster_id && node.cluster_id !== 'Genel' && node.cluster_id !== currentId) {
        ancestors.add(node.cluster_id);
        currentId = node.cluster_id;
      } else {
        break;
      }
    }

    setExpandedClusters(ancestors);

    // YENİ: Sidebar'dan seçilen düğümün sağ panelde de (InfoPanel) açılmasını sağla
    const selectedNodeObj = fullGraphData.nodes.find(n => n.id === clusterId);
    if (selectedNodeObj) {
      setSelectedNode(selectedNodeObj);
    } else if (clusterNodesRef.current[clusterId]) {
      // Eğer bu sanal bir kümeyse (örneğin sadece topic olarak var olan Veri Bilimi gibi), 
      // önceden hesaplanmış FSRS ortalamalarını içeren referansı gönder.
      setSelectedNode(clusterNodesRef.current[clusterId]);
    } else {
      setSelectedNode({ id: clusterId, label: clusterId, isVirtual: true });
    }
  };

  const clusterNodesRef = useRef({});

  // Dinamik Küme Görünümü
  useEffect(() => {
    if (!fullGraphData || !fullGraphData.nodes) return;

    let filteredNodes = fullGraphData.nodes;
    let filteredEdges = fullGraphData.edges;

    if (activeSource) {
      filteredNodes = fullGraphData.nodes.filter(n =>
        n.sources && n.sources.some(url => url.includes(activeSource.url))
      );
      const nodeIds = new Set(filteredNodes.map(n => n.id));
      filteredEdges = fullGraphData.edges.filter(e =>
        nodeIds.has(e.source?.id || e.source) && nodeIds.has(e.target?.id || e.target)
      );
    }

    if (!isClusteringMode) {
      // Kümeleme modu KAPALI ise klasik açık görünüm
      const nodes = filteredNodes.map(n => ({
        ...n,
        isCluster: false,
        isExpandedHub: false
      }));
      const edges = filteredEdges.map(e => ({
        ...e,
        source: typeof e.source === 'object' ? e.source.id : e.source,
        target: typeof e.target === 'object' ? e.target.id : e.target,
        isHubEdge: false
      }));
      setDisplayGraph({ nodes, edges });
      return;
    }

    // Kümeleme modu AÇIK ise Hiyerarşik (Tree) mantığı
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    // 1. Gerçek düğümleri nodeMap'e ekle (Orijinal referansları bozmadan!)
    filteredNodes.forEach(n => {
      n.children = [];
      n.isCluster = false;
      n.isVirtual = false;
      nodeMap.set(n.id, n);
    });

    // 2. Eğer bir cluster_id (topic) var ama nodeMap'te yoksa, onu sanal bir kök olarak ekle
    filteredNodes.forEach(n => {
      const cid = n.cluster_id;
      if (cid && cid !== 'Genel' && !nodeMap.has(cid)) {
        if (!clusterNodesRef.current[cid]) {
          clusterNodesRef.current[cid] = {
            id: cid,
            label: cid,
            cluster_id: 'Genel',
            isVirtual: true
          };
        }
        const vNode = clusterNodesRef.current[cid];
        vNode.children = [];
        vNode.isCluster = false;
        vNode.fsrs_p = undefined;
        nodeMap.set(cid, vNode);
      }
    });

    // 3. Ebeveyn - Çocuk ilişkilerini kur
    nodeMap.forEach(n => {
      const cid = n.cluster_id;
      if (cid && cid !== 'Genel' && cid !== n.id) {
        const parent = nodeMap.get(cid);
        if (parent) {
          parent.children.push(n);
          parent.isCluster = true; // Çocukları olan her node bir Cluster (Hub) olur
        }
      }
    });

    // 4. Görünür olan en üst ata'yı bulma fonksiyonu (Recursive)
    const getHighestVisibleAncestor = (nodeId) => {
      let curr = nodeMap.get(nodeId);
      let lastVisible = curr;
      const visited = new Set();
      while (curr && curr.cluster_id && curr.cluster_id !== 'Genel') {
        if (curr.cluster_id === curr.id || visited.has(curr.id)) break; // Sonsuz döngüyü engelle
        visited.add(curr.id);

        const parent = nodeMap.get(curr.cluster_id);
        if (!parent) break;
        if (!expandedClusters.has(parent.id)) {
          lastVisible = parent;
        }
        curr = parent;
      }
      return lastVisible;
    };

    const displayNodesMap = new Map();

    // 5. Görünür düğümleri belirle
    nodeMap.forEach(n => {
      const ancestor = getHighestVisibleAncestor(n.id);
      if (ancestor.id === n.id) {

        // Yeni görünür olan alt düğümlerin fırlama animasyonu için koordinat ataması
        if (n.x === undefined && n.cluster_id && n.cluster_id !== 'Genel') {
          const parent = nodeMap.get(n.cluster_id);
          if (parent && parent.x !== undefined) {
            n.x = parent.x + (Math.random() - 0.5) * 10;
            n.y = parent.y + (Math.random() - 0.5) * 10;
          }
        }

        n.isExpandedHub = n.isCluster && expandedClusters.has(n.id);
        n.member_count = n.children.length;

        // Kapalı/sanal hub'lar için ortalama fsrs_p hesapla
        if (n.children.length > 0) {
          let sum = 0, count = 0;
          n.children.forEach(c => {
            if (typeof c.fsrs_p === 'number') { sum += c.fsrs_p; count++; }
          });
          if (count > 0 && n.fsrs_p === undefined) n.fsrs_p = sum / count;
        }

        displayNodesMap.set(n.id, n);

        // Merkez (Hub) açık ise çocuklarına bağ çek
        if (n.isExpandedHub) {
          n.children.forEach(child => {
            const childAncestor = getHighestVisibleAncestor(child.id);
            if (childAncestor.id === child.id) {
              edges.push({ source: n.id, target: child.id, isHubEdge: true });
            }
          });
        }
      }
    });

    // 6. Normal çizgileri (Edges) görünür atalara göre bağla
    const edgeSet = new Set();
    filteredEdges.forEach(e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;

      const sNode = getHighestVisibleAncestor(sid);
      const tNode = getHighestVisibleAncestor(tid);

      if (sNode && tNode && sNode.id !== tNode.id) {
        const key1 = `${sNode.id}::${tNode.id}`;
        const key2 = `${tNode.id}::${sNode.id}`;
        if (!edgeSet.has(key1) && !edgeSet.has(key2)) {
          edgeSet.add(key1);
          edges.push({ ...e, source: sNode.id, target: tNode.id, isHubEdge: false });
        }
      }
    });

    setDisplayGraph({ nodes: Array.from(displayNodesMap.values()), edges });
  }, [fullGraphData, expandedClusters, activeSource, isClusteringMode]);

  const handleNodeClick = (node) => {
    if (node.isCluster) {
      setExpandedClusters(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      setFocusCluster({ id: node.id, t: Date.now() });
    }
    // Tüm düğümlerin paneli açılabilmeli
    setSelectedNode(node);
  };

  // ---- YENİ: JSON DIŞA AKTAR ----
  const handleExport = () => {
    if (fullGraphData.nodes.length === 0) {
      alert("Dışa aktarılacak veri yok!");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fullGraphData, null, 2));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", `learnsphere_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadNode);
    downloadNode.click();
    downloadNode.remove();
  };

  // ---- YENİ: JSON İÇE AKTAR ----
  const handleImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importedData = JSON.parse(e.target.result);

        const response = await fetch('http://127.0.0.1:8080/api/v1/graph/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(importedData)
        });

        if (response.ok) {
          alert("Öğrenme ağı başarıyla içe aktarıldı!");
          fetchGraph(); // Ağı yenile
        } else {
          alert("İçe aktarma sırasında sunucu hatası oluştu.");
        }
      } catch (error) {
        console.error("İçe aktarma hatası:", error);
        alert("Dosya formatı hatalı. Lütfen geçerli bir yedek yükleyin.");
      }
    };
    reader.readAsText(file);
    // Aynı dosyayı tekrar seçebilmek için input'u sıfırla
    event.target.value = null;
  };

  const stats = React.useMemo(() => {
    const now = Date.now();
    const hasP = fullGraphData.nodes.some((n) => typeof n.fsrs_p === 'number');
    let fresh = 0;
    let cooling = 0;
    for (const n of fullGraphData.nodes) {
      if (hasP) {
        if (typeof n.fsrs_p !== 'number') continue;
        if (n.fsrs_p >= 0.8) fresh++;
        else if (n.fsrs_p < 0.5) cooling++;
      } else {
        if (!n.created_at) continue;
        const ageH = (now - new Date(n.created_at).getTime()) / 36e5;
        if (ageH < 24) fresh++;
        else if (ageH > 72) cooling++;
      }
    }
    return { total: fullGraphData.nodes.length, fresh, cooling, hasP };
  }, [fullGraphData]);

  return (
    <div className="app-container notebook-layout">
      <Sidebar
        data={fullGraphData}
        onSourceSelect={handleSourceSelect}
        activeSource={activeSource}
        clusters={allClusters}
        onClusterSelect={handleClusterSelect}
        isClusteringMode={isClusteringMode}
      />

      <div className="main-content">
        <div className="header glass-panel" style={{ padding: '18px 24px', margin: '24px', width: 'max-content', position: 'absolute', zIndex: 10 }}>
          <h1 className="title-glow" style={{ cursor: 'pointer' }} onClick={handleReset} title="Tüm ağa dön">
            Living Mind Tree<span className="spark">.</span>
          </h1>

          {/* YENİ: İçe/Dışa Aktar Butonları */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px', marginBottom: '8px' }}>
            <button
              onClick={handleExport}
              style={{ background: '#374151', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              📥 Dışa Aktar
            </button>
            <button
              onClick={() => fileInputRef.current.click()}
              style={{ background: '#374151', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              📤 İçe Aktar
            </button>
            <input type="file" accept=".json" style={{ display: 'none' }} ref={fileInputRef} onChange={handleImport} />
            <button
              onClick={() => {
                const nextMode = !isClusteringMode;
                setIsClusteringMode(nextMode);
                if (!nextMode) {
                  setExpandedClusters(new Set());
                  setFocusCluster(null);
                }
              }}
              style={{
                background: isClusteringMode ? '#10B981' : '#374151',
                color: 'white',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600'
              }}
              title="Zihin haritasını konularına göre gruplar"
            >
              Konu Kümeleme: {isClusteringMode ? 'Açık' : 'Kapalı'}
            </button>
            {isClusteringMode && expandedClusters.size > 0 && (
              <button
                onClick={handleCollapseAll}
                style={{ background: '#2563EB', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                Kümeleri Daralt
              </button>
            )}
          </div>

          <div className="statbar">
            <span className="stat"><b>{stats.total}</b> kavram</span>
            <span className="dot" />
            <span className={stats.hasP ? 'stat strong' : 'stat warm'}>
              <b>{stats.fresh}</b> {stats.hasP ? 'sağlam' : 'taze köz'}
            </span>
            <span className="dot" />
            <span className={stats.hasP ? 'stat risk' : 'stat cold'}>
              <b>{stats.cooling}</b> {stats.hasP ? 'riskte' : 'soğuyor'}
            </span>
          </div>
          {activeSource && (
            <p className="filter-note">
              Filtre: {activeSource.title}
              <button onClick={handleReset}>tümüne dön</button>
            </p>
          )}
        </div>

        <div className="graph-wrapper" style={{ flex: 1, position: 'relative' }}>
          {!loading && displayGraph.nodes.length > 0 && (
            <MindMap
              data={displayGraph}
              onNodeClick={handleNodeClick}
              zoomToFitTrigger={zoomToFitTrigger}
              focusCluster={focusCluster}
              isClusteringMode={isClusteringMode}
              selectedNode={selectedNode}
            />
          )}
          {!loading && displayGraph.nodes.length === 0 && (
            <div className="empty-state">
              <h3>Zihin haritan henüz boş</h3>
              <p>
                ChatGPT, Gemini veya YouTube&apos;da öğrenmeye başla — eklenti kavramları arka planda toplayıp burada közlere dönüştürecek.
              </p>
            </div>
          )}
        </div>

        <ChatBar onSearch={handleSearch} />
      </div>

      <NodeDetailsPanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}

export default App;