import React from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  Brush,
  Circle,
  Crosshair,
  Eraser,
  GitBranch,
  Hash,
  Highlighter,
  Layers,
  MapPin,
  MessageSquare,
  Minus,
  MousePointer2,
  MoveDiagonal,
  MoveHorizontal,
  MoveVertical,
  PenTool,
  Plus,
  Ruler,
  Shapes,
  Smile,
  Sparkles,
  Square,
  StickyNote,
  TrendingDown,
  TrendingUp,
  Triangle,
  Type,
  Wand2,
  Waves,
} from 'lucide-react';

interface ToolIconProps {
  toolId: string;
  className?: string;
}

export const ToolIcon: React.FC<ToolIconProps> = ({ toolId, className = 'w-4 h-4' }) => {
  switch (toolId) {
    // Tools
    case 'tool_cross':
      return <Crosshair className={className} />;
    case 'tool_dot':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3.5" fill="currentColor" />
        </svg>
      );
    case 'tool_arrow':
      return <MousePointer2 className={className} />;
    case 'tool_demonstration':
      return <Wand2 className={className} />;
    case 'tool_magic':
      return <Sparkles className={className} />;
    case 'tool_eraser':
      return <Eraser className={className} />;

    // Trend Tools
    case 'trend_line':
      return <MoveDiagonal className={className} />;
    case 'trend_arrow':
    case 'shape_arrow':
    case 'arrow_marker':
    case 'arrow_marks':
      return <ArrowUpRight className={className} />;
    case 'ray':
    case 'extended_line':
    case 'info_line':
    case 'trend_angle':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="4" y1="19" x2="20" y2="5" />
          <circle cx="6" cy="17.2" r="2" fill="currentColor" />
          <circle cx="14" cy="10.2" r="2" fill="currentColor" />
        </svg>
      );
    case 'horizontal_line':
      return <Minus className={className} />;
    case 'horizontal_ray':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="5" cy="12" r="2.2" fill="currentColor" />
          <line x1="7" y1="12" x2="21" y2="12" />
        </svg>
      );
    case 'vertical_line':
      return <MoveVertical className={className} />;
    case 'crossline':
      return <Plus className={className} />;
    case 'parallel_channel':
    case 'flat_top_bottom':
    case 'disjoint_channel':
    case 'regression_trend':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="3" y1="15" x2="17" y2="5" />
          <line x1="7" y1="19" x2="21" y2="9" />
          <line x1="5" y1="17" x2="19" y2="7" strokeDasharray="2 2" opacity="0.7" />
        </svg>
      );
    case 'pitchfork':
    case 'inside_pitchfork':
    case 'schiff_pitchfork':
    case 'modified_schiff_pitchfork':
      return <GitBranch className={className} />;

    // Gann & Fibonacci
    case 'fib_retracement':
    case 'trend_based_fib_extension':
    case 'fib_channel':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="3" y1="5" x2="21" y2="5" />
          <line x1="3" y1="10" x2="21" y2="10" strokeDasharray="3 2" />
          <line x1="3" y1="15" x2="21" y2="15" strokeDasharray="3 2" />
          <line x1="3" y1="20" x2="21" y2="20" />
        </svg>
      );
    case 'fib_time_zone':
    case 'trend_based_fib_time':
    case 'gann_box':
    case 'gann_square':
    case 'gann_square_fixed':
      return <Hash className={className} />;
    case 'fib_speed_resistance_fan':
    case 'gann_fan':
    case 'pitchfan':
    case 'fib_wedge':
      return <Layers className={className} />;
    case 'fib_circles':
    case 'fib_spiral':
    case 'fib_speed_resistance_arcs':
      return <Circle className={className} />;

    // Patterns
    case 'xabcd_pattern':
    case 'cypher_pattern':
    case 'head_and_shoulders_pattern':
    case 'abcd_pattern':
    case 'triangle_pattern':
    case 'three_drives_pattern':
    case 'elliott_waves':
      return <Activity className={className} />;
    case 'cyclic_lines':
    case 'time_cycles':
    case 'sine_line':
      return <Waves className={className} />;

    // Forecasting & Measurement
    case 'long_position':
      return <TrendingUp className={className} />;
    case 'short_position':
      return <TrendingDown className={className} />;
    case 'position_forecast':
    case 'bars_pattern':
    case 'ghost_feed':
    case 'sector':
    case 'anchored_vwap':
    case 'fixed_range_volume_profile':
    case 'anchored_volume_profile':
      return <Layers className={className} />;
    case 'price_range':
      return <MoveVertical className={className} />;
    case 'date_range':
      return <MoveHorizontal className={className} />;
    case 'date_and_price_range':
      return <Ruler className={className} />;

    // Geometric Shapes
    case 'rectangle':
    case 'rotated_rectangle':
      return <Square className={className} />;
    case 'circle':
      return <Circle className={className} />;
    case 'ellipse':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="12" rx="9" ry="5.5" />
        </svg>
      );
    case 'triangle':
      return <Triangle className={className} />;
    case 'path':
    case 'polyline':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="4,17 9,9 14,14 20,6" />
          <polyline points="16,6 20,6 20,10" />
        </svg>
      );
    case 'arc':
    case 'curve':
    case 'double_curve':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 17 Q12 4 20 17" />
        </svg>
      );
    case 'brush':
      return <Brush className={className} />;
    case 'highlighter':
      return <Highlighter className={className} />;

    // Annotations
    case 'text':
    case 'anchored_text':
      return <Type className={className} />;
    case 'note':
    case 'price_note':
      return <StickyNote className={className} />;
    case 'pin':
      return <MapPin className={className} />;
    case 'callout':
    case 'comment':
      return <MessageSquare className={className} />;

    // Visuals
    case 'visual_emojis':
      return <Smile className={className} />;
    case 'visual_stickers':
      return <Bell className={className} />;
    case 'visual_icons':
      return <Shapes className={className} />;

    default:
      return <PenTool className={className} />;
  }
};
