import { Point } from '../../Point';
import type { Group } from '../Group';
import type { TDegree, TOriginX, TOriginY } from '../../typedefs';
import { transformPoint } from '../../util/misc/matrix';
import { sizeAfterTransform } from '../../util/misc/objectTransforms';
import { degreesToRadians } from '../../util/misc/radiansDegreesConversion';
import { CommonMethods } from '../../CommonMethods';
import { resolveOrigin } from '../../util/misc/resolveOrigin';
import type { BaseProps } from './types/BaseProps';
import type { FillStrokeProps } from './types/FillStrokeProps';
import { CENTER, LEFT, TOP } from '../../constants';

export class ObjectOrigin<EventSpec>
  extends CommonMethods<EventSpec>
  implements BaseProps, Pick<FillStrokeProps, 'strokeWidth' | 'strokeUniform'>
{
  declare top: number;
  declare left: number;
  declare width: number;
  declare height: number;
  declare flipX: boolean;
  declare flipY: boolean;
  declare scaleX: number;
  declare scaleY: number;
  declare skewX: number;
  declare skewY: number;
  declare originX: TOriginX;
  declare originY: TOriginY;
  declare angle: TDegree;
  declare strokeWidth: number;
  declare strokeUniform: boolean;

  /**
   * Object containing this object.
   * can influence its size and position
   */
  declare group?: Group;

  /**
   * Calculate object bounding box dimensions from its properties scale, skew.
   * 获取一个经过变换后的对象（比如缩放、倾斜等）的维度。这个对象的初始维度由 width 和 height 设定。而缩放级别由 scaleX 和 scaleY 设定，倾斜角度由 skewX 和 skewY 设定。这影响了对象的大小和形状，因此也需要按这些变换调整该对象的维度
   * 通常在一些其它函数中用到，比如在缩放或倾斜后得到正确的对象大小和位置，或者在渲染对象前计算正确的绘图区域等
   * @param {Object} [options]
   * @param {Number} [options.scaleX]
   * @param {Number} [options.scaleY]
   * @param {Number} [options.skewX]
   * @param {Number} [options.skewY]
   * @private
   * @returns {Point} dimensions
   */
  _getTransformedDimensions(options: any = {}): Point {
    const dimOptions = {
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      skewX: this.skewX,
      skewY: this.skewY,
      width: this.width,
      height: this.height,
      strokeWidth: this.strokeWidth,
      ...options,
    };
    // stroke is applied before/after transformations are applied according to `strokeUniform`
    const strokeWidth = dimOptions.strokeWidth;
    let preScalingStrokeValue = strokeWidth, // 线条宽度在图形变换之前就添加到图形维度上
      postScalingStrokeValue = 0;

    // 图形变换不会影响线条宽度
    if (this.strokeUniform) {
      preScalingStrokeValue = 0;
      postScalingStrokeValue = strokeWidth;
    }
    const dimX = dimOptions.width + preScalingStrokeValue,
      dimY = dimOptions.height + preScalingStrokeValue,
      noSkew = dimOptions.skewX === 0 && dimOptions.skewY === 0;
    let finalDimensions;
    // 函数计算了没有倾斜（noSkew）时的图象的新维度（也就是宽度和高度乘以对应缩放值
    if (noSkew) {
      finalDimensions = new Point(
        dimX * dimOptions.scaleX,
        dimY * dimOptions.scaleY
      );
    } else {
      // 根据变换的参数计算最终的维度
      finalDimensions = sizeAfterTransform(dimX, dimY, dimOptions);
    }

    // 函数将变换后的线条宽度添加到最终的维度上，并返回。这个结果就是经过变换后的对象的新维度
    return finalDimensions.scalarAdd(postScalingStrokeValue);
  }

  /**
   * Translates the coordinates from a set of origin to another (based on the object's dimensions)
   * 改变给定点相对的原点，也就是根据传入的新的x轴和y轴的原点进行点的转换
   * 初始时，点的坐标 x 和 y 是以 fromOriginX 和 fromOriginY 为原点的。函数的目的是找到这个点在以 toOriginX 和 toOriginY 为原点时的坐标
   * 通过这种方式，可以很容易地在不同的原点之间转换坐标，这在处理图形变换时非常有用
   * @param {Point} point The point which corresponds to the originX and originY params
   * @param {TOriginX} fromOriginX Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} fromOriginY Vertical origin: 'top', 'center' or 'bottom'
   * @param {TOriginX} toOriginX Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} toOriginY Vertical origin: 'top', 'center' or 'bottom'
   * @return {Point}
   */
  translateToGivenOrigin(
    point: Point,
    fromOriginX: TOriginX,
    fromOriginY: TOriginY,
    toOriginX: TOriginX,
    toOriginY: TOriginY
  ): Point {
    let x = point.x,
      y = point.y;
    // 函数首先计算新旧两个原点在x轴和y轴的位移 offsetX 和 offsetY，这是通过 resolveOrigin 函数来实现的。resolveOrigin 函数接收一个原点坐标（可以是字符串 'left'，'center'，'right' 对于x轴或 'top'，'center'，'bottom' 对于y轴）并将其转换成数值（左和上为0，中心为0.5，右和下为1）。因此，offsetX 和 offsetY 表示的就是新的原点到旧的原点的相对偏移量
    const offsetX = resolveOrigin(toOriginX) - resolveOrigin(fromOriginX),
      offsetY = resolveOrigin(toOriginY) - resolveOrigin(fromOriginY);

    // 如果发生了偏移（即 offsetX 或 offsetY 不为0），则将这种偏移应用到点的 x 和 y 坐标上。此处使用了 dim 来获得由 _getTransformedDimensions 方法返回的当前对象的变换后的维度，然后将 offsetX 和 offsetY 分别乘以 dim.x 和 dim.y，并添加到 x 和 y 之上
    if (offsetX || offsetY) {
      const dim = this._getTransformedDimensions();
      x += offsetX * dim.x;
      y += offsetY * dim.y;
    }

    // 函数返回一个新的 Point 对象，表示在以 toOriginX 和 toOriginY 为原点时的坐标
    return new Point(x, y);
  }

  /**
   * Translates the coordinates from origin to center coordinates (based on the object's dimensions) 将坐标从原点转换为中心坐标(基于对象的尺寸)
   * @param {Point} point The point which corresponds to the originX and originY params 对应于originX和originY参数的点
   * @param {TOriginX} originX Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} originY Vertical origin: 'top', 'center' or 'bottom'
   * @return {Point}
   */
  translateToCenterPoint(
    point: Point,
    originX: TOriginX,
    originY: TOriginY
  ): Point {
    const p = this.translateToGivenOrigin(
      point,
      originX,
      originY,
      CENTER,
      CENTER
    );
    if (this.angle) {
      return p.rotate(degreesToRadians(this.angle), point);
    }
    return p;
  }

  /**
   * Translates the coordinates from center to origin coordinates (based on the object's dimensions) 将坐标从中心坐标转换为原点坐标(基于对象的尺寸)
   * @param {Point} center The point which corresponds to center of the object
   * @param {OriginX} originX Horizontal origin: 'left', 'center' or 'right'
   * @param {OriginY} originY Vertical origin: 'top', 'center' or 'bottom'
   * @return {Point}
   */
  translateToOriginPoint(
    center: Point,
    originX: TOriginX,
    originY: TOriginY
  ): Point {
    const p = this.translateToGivenOrigin(
      center,
      CENTER,
      CENTER,
      originX,
      originY
    );
    if (this.angle) {
      return p.rotate(degreesToRadians(this.angle), center);
    }
    return p;
  }

  /**
   * Returns the center coordinates of the object relative to canvas 返回对象相对于画布的中心坐标
   * @return {Point}
   */
  getCenterPoint(): Point {
    const relCenter = this.getRelativeCenterPoint();
    return this.group
      ? transformPoint(relCenter, this.group.calcTransformMatrix())
      : relCenter;
  }

  /**
   * Returns the center coordinates of the object relative to it's parent 返回对象相对于其父对象的中心坐标
   * @return {Point}
   */
  getRelativeCenterPoint(): Point {
    return this.translateToCenterPoint(
      new Point(this.left, this.top),
      this.originX,
      this.originY
    );
  }

  /**
   * Returns the coordinates of the object as if it has a different origin 返回对象的坐标，就好像它有不同的原点一样
   * @param {TOriginX} originX Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} originY Vertical origin: 'top', 'center' or 'bottom'
   * @return {Point}
   */
  getPointByOrigin(originX: TOriginX, originY: TOriginY): Point {
    return this.translateToOriginPoint(
      this.getRelativeCenterPoint(),
      originX,
      originY
    );
  }

  /**
   * Sets the position of the object taking into consideration the object's origin 根据对象的原点设置对象的位置
   * @param {Point} pos The new position of the object
   * @param {TOriginX} originX Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} originY Vertical origin: 'top', 'center' or 'bottom'
   * @return {void}
   */
  setPositionByOrigin(pos: Point, originX: TOriginX, originY: TOriginY) {
    const center = this.translateToCenterPoint(pos, originX, originY),
      position = this.translateToOriginPoint(
        center,
        this.originX,
        this.originY
      );
    this.set({ left: position.x, top: position.y });
  }

  /**
   * @private
   */
  _getLeftTopCoords() {
    return this.translateToOriginPoint(
      this.getRelativeCenterPoint(),
      LEFT,
      TOP
    );
  }
}
