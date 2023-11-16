import type { ModifierKey, TEvent } from '../EventTypeDefs';
import type { Point } from '../Point';
import { Shadow } from '../Shadow';
import { Path } from '../shapes/Path';
import { getSmoothPathFromPoints, joinPath } from '../util/path';
import type { Canvas } from '../canvas/Canvas';
import { BaseBrush } from './BaseBrush';
import type { TSimplePathData } from '../util/path/typedefs';

/**
 * @private
 * @param {TSimplePathData} pathData SVG path commands
 * @returns {boolean}
 */
function isEmptySVGPath(pathData: TSimplePathData): boolean {
  return joinPath(pathData) === 'M 0 0 Q 0 0 0 0 L 0 0';
}

export class PencilBrush extends BaseBrush {
  /**
   * Discard points that are less than `decimate` pixel distant from each other
   * 丢弃距离小于“抽取”像素的点
   * @type Number
   * @default 0.4
   */
  decimate = 0.4;

  /**
   * Draws a straight line between last recorded point to current pointer
   * 在上次记录的点与当前指针之间绘制直线
   * Used for `shift` functionality
   *
   * @type boolean
   * @default false
   */
  drawStraightLine = false;

  /**
   * The event modifier key that makes the brush draw a straight line.
   * 绘制直线的快捷键
   * If `null` or 'none' or any other string that is not a modifier key the feature is disabled.
   * @type {ModifierKey | undefined | null}
   */
  straightLineKey: ModifierKey | undefined | null = 'shiftKey';

  private declare _points: Point[];
  private declare _hasStraightLine: boolean;
  private declare oldEnd?: Point;

  constructor(canvas: Canvas) {
    super(canvas);
    this._points = [];
    this._hasStraightLine = false;
  }

  // 不透明度 < 1 或 shadow 存在 或 this._hasStraightLine
  needsFullRender() {
    return super.needsFullRender() || this._hasStraightLine;
  }

  static drawSegment(ctx: CanvasRenderingContext2D, p1: Point, p2: Point) {
    const midPoint = p1.midPointFrom(p2); // 返回中间点
    ctx.quadraticCurveTo(p1.x, p1.y, midPoint.x, midPoint.y); // 绘制二次贝塞尔曲线
    return midPoint;
  }

  /**
   * Invoked on mouse down
   * @param {Point} pointer
   */
  onMouseDown(pointer: Point, { e }: TEvent) {
    // 先检查事件e是否为主要事件(_isMainEvent)。如果是次要事件则无效忽略，不进行处理
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    // 检查是否按下了制定的straightLineKey，如果按下，则设定绘制直线(drawStraightLine)为真。straightLineKey代表画直线的按键（例如，Shift键），检查事件e中对应的按键是否被按下
    this.drawStraightLine = !!this.straightLineKey && e[this.straightLineKey];

    // 来准备绘制，如设定起始点及其它所需状态
    this._prepareForDrawing(pointer);
    // capture coordinates immediately
    // this allows to draw dots (when movement never occurs)
    // 当前点添加到点的集合中。这样即使没有移动事件，点依然会被记录并绘制
    this._addPoint(pointer);

    // 来绘制视图
    this._render();
  }

  /**
   * 处理鼠标移动或触摸移动的事件
   * Invoked on mouse move
   * @param {Point} pointer
   */
  onMouseMove(pointer: Point, { e }: TEvent) {
    if (!this.canvas._isMainEvent(e)) {
      return;
    }
    // 如果有特定的straightLineKey被按下，则绘制直线
    this.drawStraightLine = !!this.straightLineKey && e[this.straightLineKey];

    // 如果对象限制在canvas大小内，并且当前指针超出canvas边界，结束该方法，不再继续处理
    if (this.limitedToCanvasSize === true && this._isOutSideCanvas(pointer)) {
      return;
    }

    // 使用_addPoint方法添加当前点到点集合中。如果成功添加，且此时至少有两个点，进行下一步
    if (this._addPoint(pointer) && this._points.length > 1) {
      // 检查是否需要全局重绘。如果需要，那么清空上层canvas，并调用_render方法全局重绘
      if (this.needsFullRender()) {
        // redraw curve
        // clear top canvas
        this.canvas.clearContext(this.canvas.contextTop);
        this._render();
      } else {
        // 仅仅绘制新增的线段
        const points = this._points,
          length = points.length,
          ctx = this.canvas.contextTop;
        // draw the curve update
        // 首先保存和变换当前上下文
        this._saveAndTransform(ctx);
        // 如果有已知的上次的终点，从那里开始绘制新的线段
        if (this.oldEnd) {
          ctx.beginPath();
          ctx.moveTo(this.oldEnd.x, this.oldEnd.y);
        }
        // 绘制完毕后更新上次终点的值，并绘制线段和恢复当前上下文
        this.oldEnd = PencilBrush.drawSegment(
          ctx,
          points[length - 2],
          points[length - 1]
        );
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * 处理鼠标释放或触摸结束的事件
   * Invoked on mouse up
   */
  onMouseUp({ e }: TEvent) {
    if (!this.canvas._isMainEvent(e)) {
      return true;
    }
    // 它会把drawStraightLine属性设置为false，表示不再绘制直线
    this.drawStraightLine = false;
    // 表示当前没有在绘制的线段
    this.oldEnd = undefined;
    // 对用户创建的路径进行最后的处理和添加
    this._finalizeAndAddPath();
    return false; // 表示该次操作已结束
  }

  /**
   * @private
   * @param {Point} pointer Actual mouse position related to the canvas.
   */
  _prepareForDrawing(pointer: Point) {
    this._reset();
    this._addPoint(pointer);
    this.canvas.contextTop.moveTo(pointer.x, pointer.y);
  }

  /**
   * 用于向现有的点集合中添加新的点。
   * @private
   * @param {Point} point Point to be added to points array
   */
  _addPoint(point: Point) {
    // 首先检查新的点是否和已有的最后一个点相同，如果两个点相同，则返回false并不做任何操作
    if (
      this._points.length > 1 &&
      point.eq(this._points[this._points.length - 1])
    ) {
      return false;
    }

    // 如果满足绘制直线(drawStraightLine)的条件，并且已有的点数大于1，则为了使新的直线连接上一次的终点和新的点，需要移除上一次添加的点。此操作同时将_hasStraightLine（表示已经绘制过直线）设为true
    if (this.drawStraightLine && this._points.length > 1) {
      this._hasStraightLine = true;
      this._points.pop();
    }

    // 将新的点添加到点集合中，并返回true表示添加成功。
    this._points.push(point);
    return true;
  }

  /**
   * 重置当前对象的状态，在新的绘画开始之前通常会调用它
   * Clear points array and set contextTop canvas style.
   * @private
   */
  _reset() {
    this._points = [];
    // 它调用_setBrushStyles方法来重置画布上层的画笔样式。这样在开始新的绘画时，画笔的样式会使用默认的或者新设置的样式
    this._setBrushStyles(this.canvas.contextTop);

    // 它调用_setShadow方法来设置对象上的阴影。这样在新的绘画开始时，阴影设置也会被更新
    this._setShadow();

    // 这样在开始新的绘画时，将不会再看到之前绘制的直线
    this._hasStraightLine = false;
  }

  /**
   * 在给定的canvas上下文中渲染当前对象
   * 这个方法通常在处理鼠标按下、移动和释放事件时被调用，以响应用户的绘制动作，并进行实时的渲染
   * Draw a smooth path on the topCanvas using quadraticCurveTo
   * @private
   * @param {CanvasRenderingContext2D} [ctx]
   */
  _render(ctx: CanvasRenderingContext2D = this.canvas.contextTop) {
    // 首先获取到点集合中的前两个点p1和p2
    let p1 = this._points[0],
      p2 = this._points[1];
    // 对当前的上下文进行保存和变形操作，以便在后续的操作中进行任何必须的坐标或样式的更改
    this._saveAndTransform(ctx);
    ctx.beginPath();
    //if we only have 2 points in the path and they are the same
    //it means that the user only clicked the canvas without moving the mouse
    //then we should be drawing a dot. A path isn't drawn between two identical dots
    //that's why we set them apart a bit
    // 如果点集合中只有两个点，且两点完全相同，就说明用户只是单击了画布而没有进行拖拽移动。在这种情况下，应该画一个点，而不是一条路径。因此，稍微移动两点，使其有一定的距离
    if (this._points.length === 2 && p1.x === p2.x && p1.y === p2.y) {
      const width = this.width / 1000;
      p1.x -= width;
      p2.x += width;
    }
    ctx.moveTo(p1.x, p1.y);

    // 在遍历点的集合时，对于每一对点，使用PencilBrush.drawSegment方法，在第一个点和第二个点之间绘制一条线段，以形成路径
    for (let i = 1; i < this._points.length; i++) {
      // we pick the point between pi + 1 & pi + 2 as the
      // end point and p1 as our control point.
      // 在第一个点和第二个点之间绘制一条线段，以形成路径
      PencilBrush.drawSegment(ctx, p1, p2);
      p1 = this._points[i];
      p2 = this._points[i + 1];
    }
    // Draw last line as a straight line while
    // we wait for the next point to be able to calculate
    // the bezier control point
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Converts points to SVG path
   * @param {Point[]} points Array of points
   * @return {TSimplePathData} SVG path commands
   */
  convertPointsToSVGPath(points: Point[]): TSimplePathData {
    const correction = this.width / 1000;
    return getSmoothPathFromPoints(points, correction);
  }

  /**
   * Creates a Path object to add on canvas
   * @param {TSimplePathData} pathData Path data
   * @return {Path} Path to add on canvas
   */
  createPath(pathData: TSimplePathData): Path {
    const path = new Path(pathData, {
      fill: null,
      stroke: this.color,
      strokeWidth: this.width,
      strokeLineCap: this.strokeLineCap,
      strokeMiterLimit: this.strokeMiterLimit,
      strokeLineJoin: this.strokeLineJoin,
      strokeDashArray: this.strokeDashArray,
    });
    if (this.shadow) {
      this.shadow.affectStroke = true;
      path.shadow = new Shadow(this.shadow);
    }

    return path;
  }

  /**
   * Decimate points array with the decimate value
   * 使用十进制值抽取点数组
   */
  decimatePoints(points: Point[], distance: number) {
    if (points.length <= 2) {
      return points;
    }
    let lastPoint = points[0],
      cDistance;
    const zoom = this.canvas.getZoom(),
      adjustedDistance = Math.pow(distance / zoom, 2),
      l = points.length - 1,
      newPoints = [lastPoint];
    for (let i = 1; i < l - 1; i++) {
      cDistance =
        Math.pow(lastPoint.x - points[i].x, 2) +
        Math.pow(lastPoint.y - points[i].y, 2);
      if (cDistance >= adjustedDistance) {
        lastPoint = points[i];
        newPoints.push(lastPoint);
      }
    }
    // Add the last point from the original line to the end of the array.
    // This ensures decimate doesn't delete the last point on the line, and ensures the line is > 1 point.
    newPoints.push(points[l]);
    return newPoints;
  }

  /**
   * On mouseup after drawing the path on contextTop canvas
   * we use the points captured to create an new Path object
   * and add it to the canvas.
   * 鼠标在contextTop画布上绘制路径后，使用捕获的点来创建一个新的路径对象，将其添加到画布。
   *
   */
  _finalizeAndAddPath() {
    // 方法获取到顶层画布的上下文，并调用closePath方法关闭当前路径
    const ctx = this.canvas.contextTop;
    ctx.closePath();
    if (this.decimate) {
      // 对画布上的点进行简化，以减少渲染所需的计算
      this._points = this.decimatePoints(this._points, this.decimate);
    }
    const pathData = this.convertPointsToSVGPath(this._points); // 将点集合转换为SVG路径
    if (isEmptySVGPath(pathData)) {
      // do not create 0 width/height paths, as they are
      // rendered inconsistently across browsers
      // Firefox 4, for example, renders a dot,
      // whereas Chrome 10 renders nothing
      // 如果路径为空，即路径的宽度或高度为0，那么将不会继续创建路径，因为这样的路径在不同的浏览器中渲染会有差异，有的会渲染出一个点，有的则什么也不渲染
      // 对整个画布进行渲染，然后返回
      this.canvas.requestRenderAll();
      return;
    }

    // 创建新的路径
    const path = this.createPath(pathData);
    // 清空顶层画布的内容
    this.canvas.clearContext(this.canvas.contextTop);
    this.canvas.fire('before:path:created', { path: path });
    // 将新创建的路径添加到画布中
    this.canvas.add(path);
    // 对整个画布进行渲染
    this.canvas.requestRenderAll();
    // 为新的路径设置坐标
    path.setCoords();

    // 重置阴影
    this._resetShadow();

    // fire event 'path' created
    this.canvas.fire('path:created', { path: path });
  }
}
