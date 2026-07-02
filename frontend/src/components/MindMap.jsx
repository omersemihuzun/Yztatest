import React, { useRef, useCallback, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

const MindMap = ({ data, onNodeClick }) => {
  const graphRef = useRef();
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNodeClick = useCallback(
    (node) => {
      // Düğüme yaklaş (zoom in)
      const distance = 40;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z || 0);
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(8, 2000);
      
      if (onNodeClick) onNodeClick(node);
    },
    [onNodeClick]
  );

  // backend edges -> react-force-graph links
  const graphData = {
    nodes: data.nodes || [],
    links: data.edges || []
  };

  return (
    <div className="graph-container">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        nodeLabel="label"
        nodeColor={(node) => '#bb86fc'}
        nodeRelSize={6}
        linkColor={() => 'rgba(187, 134, 252, 0.4)'}
        linkWidth={2}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.005}
        onNodeClick={handleNodeClick}
        backgroundColor="transparent"
        // Düğüm çizimi (Glow efekti)
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.label;
          const fontSize = 12 / globalScale;
          
          // Glow effect
          ctx.beginPath();
          ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI, false);
          ctx.fillStyle = '#8a2be2';
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#bb86fc';
          ctx.fill();
          
          // Reset shadow for text
          ctx.shadowBlur = 0;
          ctx.font = `${fontSize}px Sans-Serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, node.x, node.y + 12);
        }}
      />
    </div>
  );
};

export default MindMap;
