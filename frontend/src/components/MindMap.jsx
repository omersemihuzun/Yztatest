import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force-3d';

// ---- "Köz" sıcaklık skalası ----
// Taze bilgi kor gibi sıcak parlar; unutulmaya yüz tutan bilgi küle soğur.
const EMBER = {
  blaze: { fill: '#FFD9A0', glow: '#FFB454', text: 'rgba(255, 231, 200, 0.95)' }, // < 1 saat
  warm:  { fill: '#FFB454', glow: '#C9803A', text: 'rgba(255, 220, 180, 0.9)'  }, // < 24 saat
  amber: { fill: '#C9803A', glow: 'rgba(201, 128, 58, 0.5)', text: 'rgba(226, 200, 170, 0.8)' }, // < 3 gün
  cool:  { fill: '#7E7568', glow: 'transparent', text: 'rgba(180, 186, 197, 0.65)' }, // < 1 hafta
  ash:   { fill: '#4C596E', glow: 'transparent', text: 'rgba(139, 152, 172, 0.5)'  }, // daha eski
};

function emberOf(createdAt) {
  if (!createdAt) return EMBER.amber;
  const ageH = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (ageH < 1) return EMBER.blaze;
  if (ageH < 24) return EMBER.warm;
  if (ageH < 72) return EMBER.amber;
  if (ageH < 168) return EMBER.cool;
  return EMBER.ash;
}

// ---- Hatırlama olasılığı (FSRS/HLR p değeri) skalası ----
// Ekip kararı: p >= 0.80 güçlü, 0.50-0.80 kritik eşik, < 0.50 riskte.
// Renkler köz kimliğiyle harmanlandı: nane-yeşil / kehribar / kırmızı.
const RETENTION = {
  strong: { fill: '#57D9A3', glow: 'rgba(87, 217, 163, 0.55)', text: 'rgba(199, 240, 222, 0.95)' },
  mid:    { fill: '#FFB454', glow: 'rgba(255, 180, 84, 0.55)', text: 'rgba(255, 220, 180, 0.9)' },
  weak:   { fill: '#FF6B6B', glow: 'rgba(255, 107, 107, 0.6)', text: 'rgba(255, 200, 200, 0.9)' },
};

function styleOf(node) {
  // Küme düğümü (isCluster) için de aynı renk mantığı geçerli (ortalaması hesaplanıp fsrs_p'ye atandı)
  const p = node.fsrs_p;
  if (typeof p === 'number') {
    if (p >= 0.8) return RETENTION.strong;
    if (p >= 0.5) return RETENTION.mid;
    return RETENTION.weak;
  }
  return emberOf(node.created_at);
}

function isAtRisk(node) {
  return typeof node.fsrs_p === 'number' && node.fsrs_p < 0.5;
}

function isFresh(createdAt) {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) / 36e5 < 24;
}

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const MindMap = ({ data, onNodeClick, zoomToFitTrigger, focusCluster, isClusteringMode, selectedNode, highlightedPath }) => {
  const graphRef = useRef();
  const containerRef = useRef();
  const hasAutoFitted = useRef(false);

  // Seçili kavramın komşularını hesapla (Context + Focus algoritması için)
  const selectedNeighbors = useMemo(() => {
    const set = new Set();
    if (!selectedNode) return set;
    set.add(selectedNode.id);
    
    (data.edges || []).forEach(edge => {
      const sId = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const tId = typeof edge.target === 'object' ? edge.target.id : edge.target;
      if (sId === selectedNode.id) set.add(tId);
      if (tId === selectedNode.id) set.add(sId);
    });
    return set;
  }, [data.edges, selectedNode]);

  // Kümeler daraltıldığında kamerayı tüm haritayı görecek şekilde uzaklaştır
  useEffect(() => {
    if (zoomToFitTrigger > 0 && graphRef.current) {
      setTimeout(() => {
        graphRef.current.zoomToFit(600, 90);
      }, 150); // Fizik motorunun toparlanması için kısa bir süre bekle
    }
  }, [zoomToFitTrigger]);

  // Sidebar'dan bir küme seçildiğinde kamerayı o kümeye odakla
  useEffect(() => {
    if (focusCluster && graphRef.current) {
      setTimeout(() => {
        const nodes = data.nodes;
        // Açılan kümedeki kavramları ve kümenin kendisini bul
        const clusterNodes = nodes.filter(n => (n.cluster_id || 'Genel') === focusCluster.id || n.id === focusCluster.id);
        
        // Sadece geçerli koordinatlara (x,y) sahip olanları hesaba kat (Kamera boşluğa uçmasın)
        const validNodes = clusterNodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
        
        if (validNodes.length > 0) {
          const avgX = validNodes.reduce((sum, n) => sum + n.x, 0) / validNodes.length;
          const avgY = validNodes.reduce((sum, n) => sum + n.y, 0) / validNodes.length;
          // Kümenin tam ortasına orta derecede bir zoom yap
          graphRef.current.centerAt(avgX, avgY, 800);
          graphRef.current.zoom(2.5, 1000);
        }
      }, 300); // Fizik motorunun kavramları biraz dağıtmasını bekle
    }
  }, [focusCluster]);

  // Veri değişince (filtre vb.) otomatik uzaklaşmayı iptal et, 
  // zoomToFitTrigger (App.jsx'ten gelen prop) bu işi zaten manuel komutlarla yönetiyor.

  // d3-force fizik motoru ayarları: Sadece kümeleme modu açıkken aktif
  useEffect(() => {
    if (!graphRef.current) return;
    const fg = graphRef.current;

    if (isClusteringMode) {
      // Kümeleme AÇIK: Güçlü itme + çarpışma koruması
      fg.d3Force('charge').strength((node) => {
        if (node.isCluster && !node.isExpandedHub) return -800;
        if (node.isCluster && node.isExpandedHub) return -200;
        return -80;
      });

      fg.d3Force('collide', 
        forceCollide((node) => {
          if (node.isCluster && !node.isExpandedHub) return 40 + Math.min(node.member_count || 1, 20) * 2;
          if (node.isCluster && node.isExpandedHub) return 15;
          return 10;
        }).iterations(3)
      );

      fg.d3Force('link')?.distance((link) => {
        if (link.isHubEdge) return 60;
        return 40;
      });
    } else {
      // Kümeleme KAPALI: Varsayılan d3 ayarlarına dön
      fg.d3Force('charge').strength(-30);
      fg.d3Force('collide', null);
      fg.d3Force('link')?.distance(30);
    }

    fg.d3ReheatSimulation();
  }, [data, isClusteringMode]);
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (el) {
        setDimensions({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Bağlantı sayısı (degree): çok bağlanan kavram daha büyük köz olur
  const degree = useMemo(() => {
    const d = {};
    for (const e of data.edges || []) {
      d[e.source] = (d[e.source] || 0) + 1;
      d[e.target] = (d[e.target] || 0) + 1;
    }
    return d;
  }, [data]);

  const radiusOf = useCallback(
    (node) => {
      if (node.isCluster) {
        if (node.isExpandedHub) return 10; // Açıkken tatlı bir merkez (Hub) boyutu
        // Küme kapalıyken içindeki eleman sayısına (max 20) göre büyür
        return 12 + Math.min(node.member_count || 1, 20) * 1.5;
      }
      return 4 + Math.min(degree[node.id] || 0, 6) * 1.1;
    },
    [degree]
  );

  const handleNodeClick = useCallback(
    (node) => {
      // Düğümlere tıklandığında aşırı zoom yapma, sadece ekranın merkezine al
      graphRef.current.centerAt(node.x, node.y, 800);
      
      if (onNodeClick) onNodeClick(node);
    },
    [onNodeClick]
  );

  const graphData = {
    nodes: data.nodes || [],
    links: data.edges || [],
  };

  return (
    <div className="graph-container" ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeLabel="label"
        nodeRelSize={6}
        cooldownTicks={isClusteringMode ? 150 : 100}
        warmupTicks={isClusteringMode ? 50 : 0}
        linkColor={(link) => {

          const sourceCluster = link.source?.cluster_id || 'Genel';
          const targetCluster = link.target?.cluster_id || 'Genel';
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;

          if (highlightedPath) {
            const pair = [sourceId, targetId].sort();
            if (highlightedPath.edgeKeys.has(`${pair[0]}::${pair[1]}`)) {
              return 'rgba(255, 217, 160, 0.95)'; // Öğrenme yolu: altın rota
            }
          }

          const isFocusedPath = selectedNode && (sourceId === selectedNode.id || targetId === selectedNode.id);
          const inContext = !isClusteringMode || !focusCluster || 
                            sourceCluster === focusCluster.id || 
                            targetCluster === focusCluster.id ||
                            sourceId === focusCluster.id ||
                            targetId === focusCluster.id;
          
          if (!inContext && !isFocusedPath) {
            return 'rgba(139, 152, 172, 0.03)'; // Çok silik yap
          }

          // Çizginin kendi zorluk/sağlamlık rengini hesapla
          let r = 139, g = 152, b = 172, baseA = 0.14; // Default soğuk renk
          const ps = link.source?.fsrs_p;
          const pt = link.target?.fsrs_p;
          
          if (typeof ps === 'number' && typeof pt === 'number') {
            const pMin = Math.min(ps, pt);
            if (pMin < 0.5) { r = 255; g = 107; b = 107; baseA = 0.10 + pMin * 0.3; }
            else if (pMin < 0.8) { r = 255; g = 180; b = 84; baseA = 0.08 + pMin * 0.3; }
            else { r = 87; g = 217; b = 163; baseA = 0.3; }
          } else {
            const warm = isFresh(link.source?.created_at) || isFresh(link.target?.created_at);
            if (warm) { r = 255; g = 180; b = 84; baseA = 0.35; }
          }

          // Sadece kümeleme modunda: Seçili (tıklanmış) rotayı çok az belirginleştir (0.55)
          if (isClusteringMode && isFocusedPath) {
             baseA = 0.55; 
          }

          return `rgba(${r}, ${g}, ${b}, ${baseA})`;
        }}
        linkWidth={(link) => {
          const sId = typeof link.source === 'object' ? link.source.id : link.source;
          const tId = typeof link.target === 'object' ? link.target.id : link.target;
          if (highlightedPath) {
            const pair = [sId, tId].sort();
            if (highlightedPath.edgeKeys.has(`${pair[0]}::${pair[1]}`)) return 2.5;
          }

          // Normal Mod: Arkadaşının orijinal kodu (Sabit 1.2)
          if (!isClusteringMode) return 1.2;

          // Kümeleme Modu: Seçili (tıklanmış) düğümün bağlarını 'hafif' kalınlaştır (2.0)
          if (selectedNode) {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            if (sourceId === selectedNode.id || targetId === selectedNode.id) return 2.0; 
          }
          return 1.2; // Varsayılan
        }}
        linkDirectionalParticles={REDUCED_MOTION ? 0 : 1}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => 'rgba(255, 217, 160, 0.7)'}
        onNodeClick={handleNodeClick}
        onEngineStop={() => {
          if (!hasAutoFitted.current && graphRef.current) {
            graphRef.current.zoomToFit(600, 90);
            hasAutoFitted.current = true;
          }
        }}
        backgroundColor="transparent"
        nodeCanvasObject={(node, ctx, globalScale) => {
          // Fizik motoru ilk karede konum atamadan çizim yapma
          if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
          const ember = styleOf(node);
          const baseR = radiusOf(node);

          // Öğrenme yolu gösteriliyorsa, sadece rotadaki düğümler tam görünür olur
          // (küme odağı devre dışı kalır, rota önceliklidir)
          const onPath = highlightedPath ? highlightedPath.nodeIds.has(node.id) : null;

          // CONTEXT + FOCUS (Bağlam ve Odak) Modu:
          let isVisible = true;
          if (highlightedPath) {
            isVisible = onPath;
          } else if (isClusteringMode && focusCluster) {
            const inContext = (node.cluster_id || 'Genel') === focusCluster.id || node.id === focusCluster.id;
            const inFocus = selectedNode ? selectedNeighbors.has(node.id) : false;

            isVisible = inContext || inFocus;
          }
          ctx.globalAlpha = isVisible ? 1.0 : 0.15;

          // Riskteki kavramlar (p < 0.5) dikkat çekmek için nefes alır;
          // p verisi yoksa eski davranış: taze közler nefes alır.
          let r = baseR;
          const shouldPulse = isAtRisk(node) ||
            (node.fsrs_p === undefined && isFresh(node.created_at));
          if (!REDUCED_MOTION && shouldPulse) {
            r = baseR + Math.sin(Date.now() / 600 + (node.index || 0)) * 0.8;
          }

          // Dış ısı halkası (glow) - Ekip arkadaşının tasarımına sadık kalındı
          // Küme düğümleri çok büyük olabildiği için parlama katsayısı 3.2'den 1.8'e düşürüldü
          if (ember.glow !== 'transparent') {
            const halo = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, r * 1.8);
            halo.addColorStop(0, ember.glow + (ember.glow.startsWith('rgba') ? '' : '55'));
            halo.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath();
            ctx.arc(node.x, node.y, r * 1.8, 0, 2 * Math.PI, false);
            ctx.fillStyle = halo;
            ctx.fill();
          }

          // Köz çekirdeği
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
          ctx.fillStyle = ember.fill;
          ctx.fill();

          // Sıcak közlerde parlak iç nokta
          if (ember === EMBER.blaze || ember === EMBER.warm) {
            ctx.beginPath();
            ctx.arc(node.x - r * 0.25, node.y - r * 0.25, r * 0.35, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'rgba(255, 245, 225, 0.9)';
            ctx.fill();
          }

          // Öğrenme yolu: zayıf durak (weak stop) kesikli uyarı halkası
          if (onPath && highlightedPath.weakIds.has(node.id)) {
            ctx.beginPath();
            ctx.setLineDash([4, 3]);
            ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI, false);
            ctx.strokeStyle = 'rgba(255, 107, 107, 0.9)';
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // Etiket
          const fontSize = Math.max(11 / globalScale, 2.2);
          ctx.font = `500 ${fontSize}px 'IBM Plex Sans', sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = ember.text;
          ctx.fillText(node.label, node.x, node.y + r + 3);
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radiusOf(node) + 6, 0, 2 * Math.PI, false);
          ctx.fillStyle = color;
          ctx.fill();
        }}
      />
    </div>
  );
};

export default MindMap;
