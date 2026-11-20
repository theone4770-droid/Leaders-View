import { DrawingCategoryId, DrawingToolDefinition } from '../types/chart';

export interface DrawingCategoryMeta {
  id: DrawingCategoryId;
  label: string;
}

/** Exact 9 categories in exact required order */
export const DRAWING_CATEGORIES: DrawingCategoryMeta[] = [
  { id: 'FAVORITES', label: 'FAVORITES' },
  { id: 'TOOLS', label: 'TOOLS' },
  { id: 'TREND_TOOLS', label: 'TREND TOOLS' },
  { id: 'GANN_AND_FIBONACCI', label: 'GANN AND FIBONACCI' },
  { id: 'PATTERNS', label: 'PATTERNS' },
  { id: 'FORECASTING_AND_MEASUREMENT', label: 'FORECASTING AND MEASUREMENT' },
  { id: 'GEOMETRIC_SHAPES', label: 'GEOMETRIC SHAPES' },
  { id: 'ANNOTATION', label: 'ANNOTATION' },
  { id: 'VISUALS', label: 'VISUALS' },
];

/** Exact 11 preloaded favorite tool IDs in exact required order */
export const PRESET_FAVORITE_TOOL_IDS: string[] = [
  // TREND TOOLS
  'trend_line',
  'horizontal_ray',
  'parallel_channel',
  // GANN AND FIBONACCI
  'fib_retracement',
  // FORECASTING AND MEASUREMENT
  'long_position',
  'short_position',
  'date_and_price_range',
  // GEOMETRIC SHAPES
  'rectangle',
  'path',
  'ellipse',
  'curve',
];

export const DRAWING_TOOLS: DrawingToolDefinition[] = [
  // 2. TOOLS
  { id: 'tool_cross', name: 'CROSS', category: 'TOOLS', pointCount: 0, isCursorTool: true },
  { id: 'tool_dot', name: 'DOT', category: 'TOOLS', pointCount: 0, isCursorTool: true },
  { id: 'tool_arrow', name: 'ARROW', category: 'TOOLS', pointCount: 0, isCursorTool: true },
  { id: 'tool_demonstration', name: 'DEMONSTRATION', category: 'TOOLS', pointCount: 0, isCursorTool: true },
  { id: 'tool_magic', name: 'MAGIC', category: 'TOOLS', pointCount: 0, isCursorTool: true },
  { id: 'tool_eraser', name: 'ERASER', category: 'TOOLS', pointCount: 0, isCursorTool: true },

  // 3. TREND TOOLS
  { id: 'trend_line', name: 'TREND LINE', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'trend_arrow', name: 'ARROW', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'ray', name: 'RAY', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'info_line', name: 'INFO LINE', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'extended_line', name: 'EXTENDED LINE', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'trend_angle', name: 'TREND ANGLE', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'horizontal_line', name: 'HORIZONTAL LINE', category: 'TREND_TOOLS', pointCount: 1 },
  { id: 'horizontal_ray', name: 'HORIZONTAL RAY', category: 'TREND_TOOLS', pointCount: 1 },
  { id: 'vertical_line', name: 'VERTICAL LINE', category: 'TREND_TOOLS', pointCount: 1 },
  { id: 'crossline', name: 'CROSSLINE', category: 'TREND_TOOLS', pointCount: 1 },
  { id: 'parallel_channel', name: 'PARALLEL CHANNEL', category: 'TREND_TOOLS', pointCount: 3 },
  { id: 'regression_trend', name: 'REGRESSION TREND', category: 'TREND_TOOLS', pointCount: 2 },
  { id: 'flat_top_bottom', name: 'FLAT TOP/BOTTOM', category: 'TREND_TOOLS', pointCount: 3 },
  { id: 'disjoint_channel', name: 'DISJOINT CHANNEL', category: 'TREND_TOOLS', pointCount: 3 },
  { id: 'pitchfork', name: 'PITCHFORK', category: 'TREND_TOOLS', pointCount: 3 },
  { id: 'inside_pitchfork', name: 'INSIDE PITCHFORK', category: 'TREND_TOOLS', pointCount: 3 },
  { id: 'schiff_pitchfork', name: 'SCHIFF PITCHFORK', category: 'TREND_TOOLS', pointCount: 3 },
  { id: 'modified_schiff_pitchfork', name: 'MODIFIED SCHIFF PITCHFORK', category: 'TREND_TOOLS', pointCount: 3 },

  // 4. GANN AND FIBONACCI
  { id: 'fib_retracement', name: 'FIBONACCI RETRACEMENT', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'trend_based_fib_extension', name: 'TREND-BASED FIB EXTENSION', category: 'GANN_AND_FIBONACCI', pointCount: 3 },
  { id: 'fib_channel', name: 'FIB CHANNEL', category: 'GANN_AND_FIBONACCI', pointCount: 3 },
  { id: 'fib_time_zone', name: 'FIB TIME ZONE', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'fib_speed_resistance_fan', name: 'FIB SPEED RESISTANCE FAN', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'trend_based_fib_time', name: 'TREND-BASED FIB TIME', category: 'GANN_AND_FIBONACCI', pointCount: 3 },
  { id: 'fib_circles', name: 'FIB CIRCLES', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'fib_spiral', name: 'FIB SPIRAL', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'fib_speed_resistance_arcs', name: 'FIB SPEED RESISTANCE ARCS', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'fib_wedge', name: 'FIB WEDGE', category: 'GANN_AND_FIBONACCI', pointCount: 3 },
  { id: 'pitchfan', name: 'PITCHFAN', category: 'GANN_AND_FIBONACCI', pointCount: 3 },
  { id: 'gann_box', name: 'GANN BOX', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'gann_square_fixed', name: 'GANN SQUARE FIXED', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'gann_square', name: 'GANN SQUARE', category: 'GANN_AND_FIBONACCI', pointCount: 2 },
  { id: 'gann_fan', name: 'GANN FAN', category: 'GANN_AND_FIBONACCI', pointCount: 2 },

  // 5. PATTERNS
  { id: 'xabcd_pattern', name: 'XABCD PATTERN', category: 'PATTERNS', pointCount: 5 },
  { id: 'cypher_pattern', name: 'CYPHER PATTERN', category: 'PATTERNS', pointCount: 5 },
  { id: 'head_and_shoulders_pattern', name: 'HEAD AND SHOULDERS PATTERN', category: 'PATTERNS', pointCount: 7 },
  { id: 'abcd_pattern', name: 'ABCD PATTERN', category: 'PATTERNS', pointCount: 4 },
  { id: 'triangle_pattern', name: 'TRIANGLE PATTERN', category: 'PATTERNS', pointCount: 4 },
  { id: 'three_drives_pattern', name: 'THREE DRIVES PATTERN', category: 'PATTERNS', pointCount: 6 },
  { id: 'elliott_waves', name: 'ELLIOTT WAVES', category: 'PATTERNS', pointCount: 6 },
  { id: 'cyclic_lines', name: 'CYCLIC LINES', category: 'PATTERNS', pointCount: 2 },
  { id: 'time_cycles', name: 'TIME CYCLES', category: 'PATTERNS', pointCount: 2 },
  { id: 'sine_line', name: 'SINE LINE', category: 'PATTERNS', pointCount: 2 },

  // 6. FORECASTING AND MEASUREMENT
  { id: 'long_position', name: 'LONG POSITION', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2, defaultColor: '#19B87D' },
  { id: 'short_position', name: 'SHORT POSITION', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2, defaultColor: '#E54855' },
  { id: 'position_forecast', name: 'POSITION FORECAST', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'bars_pattern', name: 'BARS PATTERN', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'ghost_feed', name: 'GHOST FEED', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'sector', name: 'SECTOR', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'anchored_vwap', name: 'ANCHORED VWAP', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 1 },
  { id: 'fixed_range_volume_profile', name: 'FIXED RANGE VOLUME PROFILE', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'anchored_volume_profile', name: 'ANCHORED VOLUME PROFILE', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 1 },
  { id: 'price_range', name: 'PRICE RANGE', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'date_range', name: 'DATE RANGE', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },
  { id: 'date_and_price_range', name: 'DATE AND PRICE RANGE', category: 'FORECASTING_AND_MEASUREMENT', pointCount: 2 },

  // 7. GEOMETRIC SHAPES
  { id: 'rectangle', name: 'RECTANGLE', category: 'GEOMETRIC_SHAPES', pointCount: 2 },
  { id: 'rotated_rectangle', name: 'ROTATED RECTANGLE', category: 'GEOMETRIC_SHAPES', pointCount: 3 },
  { id: 'path', name: 'PATH', category: 'GEOMETRIC_SHAPES', pointCount: -1 },
  { id: 'circle', name: 'CIRCLE', category: 'GEOMETRIC_SHAPES', pointCount: 2 },
  { id: 'ellipse', name: 'ELLIPSE', category: 'GEOMETRIC_SHAPES', pointCount: 2 },
  { id: 'polyline', name: 'POLYLINE', category: 'GEOMETRIC_SHAPES', pointCount: -1 },
  { id: 'triangle', name: 'TRIANGLE', category: 'GEOMETRIC_SHAPES', pointCount: 3 },
  { id: 'arc', name: 'ARC', category: 'GEOMETRIC_SHAPES', pointCount: 3 },
  { id: 'curve', name: 'CURVE', category: 'GEOMETRIC_SHAPES', pointCount: 3 },
  { id: 'double_curve', name: 'DOUBLE CURVE', category: 'GEOMETRIC_SHAPES', pointCount: 4 },
  { id: 'brush', name: 'BRUSH', category: 'GEOMETRIC_SHAPES', pointCount: -2 },
  { id: 'highlighter', name: 'HIGHLIGHTER', category: 'GEOMETRIC_SHAPES', pointCount: -2 },
  { id: 'shape_arrow', name: 'ARROW', category: 'GEOMETRIC_SHAPES', pointCount: 2 },
  { id: 'arrow_marker', name: 'ARROW MARKER', category: 'GEOMETRIC_SHAPES', pointCount: 2 },
  { id: 'arrow_marks', name: 'ARROW MARKS', category: 'GEOMETRIC_SHAPES', pointCount: 1 },

  // 8. ANNOTATION — EXACTLY 7 TOOLS
  { id: 'text', name: 'TEXT', category: 'ANNOTATION', pointCount: 1 },
  { id: 'anchored_text', name: 'ANCHORED TEXT', category: 'ANNOTATION', pointCount: 1 },
  { id: 'note', name: 'NOTE', category: 'ANNOTATION', pointCount: 1 },
  { id: 'price_note', name: 'PRICE NOTE', category: 'ANNOTATION', pointCount: 1 },
  { id: 'pin', name: 'PIN', category: 'ANNOTATION', pointCount: 1 },
  { id: 'callout', name: 'CALLOUT', category: 'ANNOTATION', pointCount: 2 },
  { id: 'comment', name: 'COMMENT', category: 'ANNOTATION', pointCount: 1 },

  // 9. VISUALS — EXACTLY 3 OPTIONS
  { id: 'visual_emojis', name: 'EMOJIS', category: 'VISUALS', pointCount: 1, isVisualPicker: 'EMOJIS' },
  { id: 'visual_stickers', name: 'STICKERS', category: 'VISUALS', pointCount: 1, isVisualPicker: 'STICKERS' },
  { id: 'visual_icons', name: 'ICONS', category: 'VISUALS', pointCount: 1, isVisualPicker: 'ICONS' },
];

export const TOOL_BY_ID: Record<string, DrawingToolDefinition> = DRAWING_TOOLS.reduce(
  (acc, tool) => {
    acc[tool.id] = tool;
    return acc;
  },
  {} as Record<string, DrawingToolDefinition>
);

export const VISUAL_EMOJIS = ['🚀', '🔥', '💎', '🎯', '⚡', '👑', '📈', '📉', '💰', '🏆', '⚠️', '✅', '❌', '🔔', '⭐', '🛡️'];
export const VISUAL_STICKERS = ['BULL', 'BEAR', 'BOS', 'CHoCH', 'FVG', 'OB', 'LIQ', 'TP1', 'TP2', 'SL', 'ENTRY', 'HIGH'];
export const VISUAL_ICONS = ['▲', '▼', '◆', '★', '✦', '◉', '⊕', '⊗', '↗', '↘', '⚑', '❖'];
