import type {
  TBBox,
  TCornerPoint,
  TDegree,
  TMat2D,
  TOriginX,
  TOriginY,
} from '../../typedefs';
import { iMatrix } from '../../constants';
import { Intersection } from '../../Intersection';
import { Point } from '../../Point';
import { makeBoundingBoxFromPoints } from '../../util/misc/boundingBoxFromPoints';
import { cos } from '../../util/misc/cos';
import {
  createRotateMatrix,
  createTranslateMatrix,
  composeMatrix,
  invertTransform,
  multiplyTransformMatrices,
  qrDecompose,
  transformPoint,
} from '../../util/misc/matrix';
import { degreesToRadians } from '../../util/misc/radiansDegreesConversion';
import { sin } from '../../util/misc/sin';
import type { Canvas } from '../../canvas/Canvas';
import type { StaticCanvas } from '../../canvas/StaticCanvas';
import { ObjectOrigin } from './ObjectOrigin';
import type { ObjectEvents } from '../../EventTypeDefs';
import type { ControlProps } from './types/ControlProps';

type TMatrixCache = {
  key: string;
  value: TMat2D;
};

type TACoords = TCornerPoint;

export class ObjectGeometry<EventSpec extends ObjectEvents = ObjectEvents>
  extends ObjectOrigin<EventSpec>
  implements Pick<ControlProps, 'padding'>
{
  declare padding: number;

  /**
   * 在画布对象绝对坐标中描述对象的角位置属性分别是tl、tr、bl、br和描述四个主角
   * Describe object's corner position in canvas object absolute coordinates
   * properties are tl,tr,bl,br and describe the four main corner.
   * each property is an object with x, y, instance of Fabric.Point.
   * The coordinates depends from this properties: width, height, scaleX, scaleY
   * skewX, skewY, angle, strokeWidth, top, left.
   * Those coordinates are useful to understand where an object is. They get updated
   * with lineCoords or oCoords in interactive cases but they do not need to be updated when zoom or panning change.
   * The coordinates get updated with @method setCoords.
   * You can calculate them without updating with @method calcACoords();
   */
  declare aCoords: TACoords;

  /**
   * Describe object's corner position in canvas element coordinates.
   * includes padding. Used of object detection.
   * set and refreshed with setCoords.
   * Those could go away
   * @todo investigate how to get rid of those
   */
  declare lineCoords: TCornerPoint;

  /**
   * storage cache for object transform matrix
   */
  declare ownMatrixCache?: TMatrixCache;

  /**
   * storage cache for object full transform matrix
   */
  declare matrixCache?: TMatrixCache;

  /**
   * A Reference of the Canvas where the object is actually added
   * @type StaticCanvas | Canvas;
   * @default undefined
   * @private
   */
  declare canvas?: StaticCanvas | Canvas;

  /**
   * @returns {number} x position according to object's {@link originX} property in canvas coordinate plane
   */
  getX(): number {
    return this.getXY().x;
  }

  /**
   * @param {number} value x position according to object's {@link originX} property in canvas coordinate plane
   */
  setX(value: number) {
    this.setXY(this.getXY().setX(value));
  }

  /**
   * @returns {number} y position according to object's {@link originY} property in canvas coordinate plane
   */
  getY(): number {
    return this.getXY().y;
  }

  /**
   * @param {number} value y position according to object's {@link originY} property in canvas coordinate plane
   */
  setY(value: number) {
    this.setXY(this.getXY().setY(value));
  }

  /**
   * @returns {number} x position according to object's {@link originX} property in parent's coordinate plane\
   * if parent is canvas then this property is identical to {@link getX}
   */
  getRelativeX(): number {
    return this.left;
  }

  /**
   * @param {number} value x position according to object's {@link originX} property in parent's coordinate plane\
   * if parent is canvas then this method is identical to {@link setX}
   */
  setRelativeX(value: number) {
    this.left = value;
  }

  /**
   * @returns {number} y position according to object's {@link originY} property in parent's coordinate plane\
   * if parent is canvas then this property is identical to {@link getY}
   */
  getRelativeY(): number {
    return this.top;
  }

  /**
   * @param {number} value y position according to object's {@link originY} property in parent's coordinate plane\
   * if parent is canvas then this property is identical to {@link setY}
   */
  setRelativeY(value: number) {
    this.top = value;
  }

  /**
   * @returns {Point} x position according to object's {@link originX} {@link originY} properties in canvas coordinate plane
   */
  getXY(): Point {
    const relativePosition = this.getRelativeXY();
    return this.group
      ? transformPoint(relativePosition, this.group.calcTransformMatrix())
      : relativePosition;
  }

  /**
   * Set an object position to a particular point, the point is intended in absolute ( canvas ) coordinate.
   * You can specify {@link originX} and {@link originY} values,
   * that otherwise are the object's current values.
   * @example <caption>Set object's bottom left corner to point (5,5) on canvas</caption>
   * object.setXY(new Point(5, 5), 'left', 'bottom').
   * @param {Point} point position in canvas coordinate plane
   * @param {TOriginX} [originX] Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} [originY] Vertical origin: 'top', 'center' or 'bottom'
   */
  setXY(point: Point, originX?: TOriginX, originY?: TOriginY) {
    if (this.group) {
      point = transformPoint(
        point,
        invertTransform(this.group.calcTransformMatrix())
      );
    }
    this.setRelativeXY(point, originX, originY);
  }

  /**
   * @returns {Point} x,y position according to object's {@link originX} {@link originY} properties in parent's coordinate plane
   */
  getRelativeXY(): Point {
    return new Point(this.left, this.top);
  }

  /**
   * As {@link setXY}, but in current parent's coordinate plane (the current group if any or the canvas)
   * @param {Point} point position according to object's {@link originX} {@link originY} properties in parent's coordinate plane
   * @param {TOriginX} [originX] Horizontal origin: 'left', 'center' or 'right'
   * @param {TOriginY} [originY] Vertical origin: 'top', 'center' or 'bottom'
   */
  setRelativeXY(point: Point, originX?: TOriginX, originY?: TOriginY) {
    this.setPositionByOrigin(
      point,
      originX || this.originX,
      originY || this.originY
    );
  }

  /**
   * return correct set of coordinates for intersection
   * this will return either aCoords or lineCoords.
   * @param {boolean} absolute will return aCoords if true or lineCoords
   * @param {boolean} calculate will calculate the coords or use the one
   * that are attached to the object instance
   * @return {Object} {tl, tr, br, bl} points
   */
  private _getCoords(absolute = false, calculate = false): TCornerPoint {
    if (calculate) {
      return absolute ? this.calcACoords() : this.calcLineCoords();
    }
    // swapped this double if in place of setCoords();
    if (!this.aCoords) {
      this.aCoords = this.calcACoords();
    }
    if (!this.lineCoords) {
      this.lineCoords = this.calcLineCoords();
    }
    return absolute ? this.aCoords : this.lineCoords;
  }

  /**
   * return correct set of coordinates for intersection
   * this will return either aCoords or lineCoords.
   * The coords are returned in an array.
   * @param {boolean} absolute will return aCoords if true or lineCoords
   * @param {boolean} calculate will return aCoords if true or lineCoords
   * @return {Array} [tl, tr, br, bl] of points
   */
  getCoords(absolute = false, calculate = false): Point[] {
    const { tl, tr, br, bl } = this._getCoords(absolute, calculate);
    const coords = [tl, tr, br, bl];
    if (this.group) {
      const t = this.group.calcTransformMatrix();
      return coords.map((p) => transformPoint(p, t));
    }
    return coords;
  }

  /**
   * Checks if object intersects with an area formed by 2 points
   * @param {Object} pointTL top-left point of area
   * @param {Object} pointBR bottom-right point of area
   * @param {Boolean} [absolute] use coordinates without viewportTransform
   * @param {Boolean} [calculate] use coordinates of current position instead of stored one
   * @return {Boolean} true if object intersects with an area formed by 2 points
   */
  intersectsWithRect(
    pointTL: Point,
    pointBR: Point,
    absolute?: boolean,
    calculate?: boolean
  ): boolean {
    const coords = this.getCoords(absolute, calculate),
      intersection = Intersection.intersectPolygonRectangle(
        coords,
        pointTL,
        pointBR
      );
    return intersection.status === 'Intersection';
  }

  /**
   * Checks if object intersects with another object 检查对象是否与另一个对象相交
   * @param {Object} other Object to test
   * @param {Boolean} [absolute] use coordinates without viewportTransform 使用不带viewportTransform的坐标
   * @param {Boolean} [calculate] use coordinates of current position instead of calculating them 使用当前位置的坐标，而不是计算它们
   * @return {Boolean} true if object intersects with another object
   */
  intersectsWithObject(
    other: ObjectGeometry,
    absolute = false,
    calculate = false
  ): boolean {
    const intersection = Intersection.intersectPolygonPolygon(
      this.getCoords(absolute, calculate),
      other.getCoords(absolute, calculate)
    );

    return (
      intersection.status === 'Intersection' ||
      intersection.status === 'Coincident' ||
      other.isContainedWithinObject(this, absolute, calculate) ||
      this.isContainedWithinObject(other, absolute, calculate)
    );
  }

  /**
   * Checks if object is fully contained within area of another object
   * @param {Object} other Object to test
   * @param {Boolean} [absolute] use coordinates without viewportTransform
   * @param {Boolean} [calculate] use coordinates of current position instead of stored ones
   * @return {Boolean} true if object is fully contained within area of another object
   */
  isContainedWithinObject(
    other: ObjectGeometry,
    absolute = false,
    calculate = false
  ): boolean {
    const points = this.getCoords(absolute, calculate);
    calculate && other.getCoords(absolute, true);
    return points.every((point) => other.containsPoint(point));
  }

  /**
   * Checks if object is fully contained within area formed by 2 points
   * @param {Object} pointTL top-left point of area
   * @param {Object} pointBR bottom-right point of area
   * @param {Boolean} [absolute] use coordinates without viewportTransform
   * @param {Boolean} [calculate] use coordinates of current position instead of stored one
   * @return {Boolean} true if object is fully contained within area formed by 2 points
   */
  isContainedWithinRect(
    pointTL: Point,
    pointBR: Point,
    absolute?: boolean,
    calculate?: boolean
  ): boolean {
    const boundingRect = this.getBoundingRect(absolute, calculate);
    return (
      boundingRect.left >= pointTL.x &&
      boundingRect.left + boundingRect.width <= pointBR.x &&
      boundingRect.top >= pointTL.y &&
      boundingRect.top + boundingRect.height <= pointBR.y
    );
  }

  isOverlapping<T extends ObjectGeometry>(other: T): boolean {
    return (
      this.intersectsWithObject(other) ||
      this.isContainedWithinObject(other) ||
      other.isContainedWithinObject(this)
    );
  }

  /**
   * Checks if point is inside the object
   * @param {Point} point Point to check against
   * @param {Boolean} [absolute] use coordinates without viewportTransform
   * @param {Boolean} [calculate] use coordinates of current position instead of stored ones
   * @return {Boolean} true if point is inside the object
   */
  containsPoint(point: Point, absolute = false, calculate = false): boolean {
    return Intersection.isPointInPolygon(
      point,
      this.getCoords(absolute, calculate)
    );
  }

  /**
   * Checks if object is contained within the canvas with current viewportTransform
   * the check is done stopping at first point that appears on screen
   * @param {Boolean} [calculate] use coordinates of current position instead of .aCoords
   * @return {Boolean} true if object is fully or partially contained within canvas
   */
  isOnScreen(calculate = false): boolean {
    if (!this.canvas) {
      return false;
    }
    const { tl, br } = this.canvas.vptCoords;
    const points = this.getCoords(true, calculate);
    // if some point is on screen, the object is on screen.
    if (
      points.some(
        (point) =>
          point.x <= br.x &&
          point.x >= tl.x &&
          point.y <= br.y &&
          point.y >= tl.y
      )
    ) {
      return true;
    }
    // no points on screen, check intersection with absolute coordinates
    if (this.intersectsWithRect(tl, br, true, calculate)) {
      return true;
    }
    return this._containsCenterOfCanvas(tl, br, calculate);
  }

  /**
   * Checks if the object contains the midpoint between canvas extremities
   * Does not make sense outside the context of isOnScreen and isPartiallyOnScreen
   * @private
   * @param {Point} pointTL Top Left point
   * @param {Point} pointBR Top Right point
   * @param {Boolean} calculate use coordinates of current position instead of stored ones
   * @return {Boolean} true if the object contains the point
   */
  private _containsCenterOfCanvas(
    pointTL: Point,
    pointBR: Point,
    calculate?: boolean
  ): boolean {
    // worst case scenario the object is so big that contains the screen
    const centerPoint = pointTL.midPointFrom(pointBR);
    return this.containsPoint(centerPoint, true, calculate);
  }

  /**
   * Checks if object is partially contained within the canvas with current viewportTransform
   * @param {Boolean} [calculate] use coordinates of current position instead of stored ones
   * @return {Boolean} true if object is partially contained within canvas
   */
  isPartiallyOnScreen(calculate?: boolean): boolean {
    if (!this.canvas) {
      return false;
    }
    const { tl, br } = this.canvas.vptCoords;
    if (this.intersectsWithRect(tl, br, true, calculate)) {
      return true;
    }
    const allPointsAreOutside = this.getCoords(true, calculate).every(
      (point) =>
        (point.x >= br.x || point.x <= tl.x) &&
        (point.y >= br.y || point.y <= tl.y)
    );
    return (
      allPointsAreOutside && this._containsCenterOfCanvas(tl, br, calculate)
    );
  }

  /**
   * Returns coordinates of object's bounding rectangle (left, top, width, height)
   * the box is intended as aligned to axis of canvas.
   * @param {Boolean} [absolute] use coordinates without viewportTransform
   * @param {Boolean} [calculate] use coordinates of current position instead of .lineCoords / .aCoords
   * @return {Object} Object with left, top, width, height properties
   */
  getBoundingRect(absolute?: boolean, calculate?: boolean): TBBox {
    return makeBoundingBoxFromPoints(this.getCoords(absolute, calculate));
  }

  /**
   * Returns width of an object's bounding box counting transformations
   * @todo shouldn't this account for group transform and return the actual size in canvas coordinate plane?
   * @return {Number} width value
   */
  getScaledWidth(): number {
    return this._getTransformedDimensions().x;
  }

  /**
   * Returns height of an object bounding box counting transformations
   * @todo shouldn't this account for group transform and return the actual size in canvas coordinate plane?
   * @return {Number} height value
   */
  getScaledHeight(): number {
    return this._getTransformedDimensions().y;
  }

  /**
   * Scales an object (equally by x and y)
   * @param {Number} value Scale factor
   * @return {void}
   */
  scale(value: number): void {
    this._set('scaleX', value);
    this._set('scaleY', value);
    this.setCoords();
  }

  /**
   * Scales an object to a given width, with respect to bounding box (scaling by x/y equally)
   * @param {Number} value New width value
   * @param {Boolean} absolute ignore viewport
   * @return {void}
   */
  scaleToWidth(value: number, absolute?: boolean) {
    // adjust to bounding rect factor so that rotated shapes would fit as well
    const boundingRectFactor =
      this.getBoundingRect(absolute).width / this.getScaledWidth();
    return this.scale(value / this.width / boundingRectFactor);
  }

  /**
   * Scales an object to a given height, with respect to bounding box (scaling by x/y equally)
   * @param {Number} value New height value
   * @param {Boolean} absolute ignore viewport
   * @return {void}
   */
  scaleToHeight(value: number, absolute = false) {
    // adjust to bounding rect factor so that rotated shapes would fit as well
    const boundingRectFactor =
      this.getBoundingRect(absolute).height / this.getScaledHeight();
    return this.scale(value / this.height / boundingRectFactor);
  }

  getCanvasRetinaScaling() {
    return this.canvas?.getRetinaScaling() || 1;
  }

  /**
   * Returns the object angle relative to canvas counting also the group property
   * @returns {TDegree}
   */
  getTotalAngle(): TDegree {
    return this.group
      ? qrDecompose(this.calcTransformMatrix()).angle
      : this.angle;
  }

  /**
   * return the coordinate of the 4 corners of the bounding box in HTMLCanvasElement coordinates 返回HTMLCanvasElement坐标中边界框四个角的坐标
   * used for bounding box interactivity with the mouse
   * @returns {TCornerPoint}
   */
  calcLineCoords(): TCornerPoint {
    const vpt = this.getViewportTransform(),
      padding = this.padding,
      angle = degreesToRadians(this.getTotalAngle()),
      cosP = cos(angle) * padding,
      sinP = sin(angle) * padding,
      cosPSinP = cosP + sinP,
      cosPMinusSinP = cosP - sinP,
      { tl, tr, bl, br } = this.calcACoords();

    const lineCoords: TCornerPoint = {
      tl: transformPoint(tl, vpt),
      tr: transformPoint(tr, vpt),
      bl: transformPoint(bl, vpt),
      br: transformPoint(br, vpt),
    };

    if (padding) {
      lineCoords.tl.x -= cosPMinusSinP;
      lineCoords.tl.y -= cosPSinP;
      lineCoords.tr.x += cosPSinP;
      lineCoords.tr.y -= cosPMinusSinP;
      lineCoords.bl.x -= cosPSinP;
      lineCoords.bl.y += cosPMinusSinP;
      lineCoords.br.x += cosPMinusSinP;
      lineCoords.br.y += cosPSinP;
    }

    return lineCoords;
  }

  /**
   * Retrieves viewportTransform from Object's canvas if possible
   * @method getViewportTransform
   * @memberOf FabricObject.prototype
   * @return {TMat2D}
   */
  getViewportTransform(): TMat2D {
    return this.canvas?.viewportTransform || (iMatrix.concat() as TMat2D);
  }

  /**
   * Calculates the coordinates of the 4 corner of the bbox, in absolute coordinates. 计算四个角坐标，以绝对坐标表示
   * those never change with zoom or viewport changes. 不会随着缩放或视口的改变而改变
   * @return {TCornerPoint}
   */
  calcACoords(): TCornerPoint {
    const rotateMatrix = createRotateMatrix({ angle: this.angle }),
      { x, y } = this.getRelativeCenterPoint(),
      tMatrix = createTranslateMatrix(x, y), 
      finalMatrix = multiplyTransformMatrices(tMatrix, rotateMatrix),
      dim = this._getTransformedDimensions(),
      w = dim.x / 2,
      h = dim.y / 2;
    return {
      // corners
      tl: transformPoint({ x: -w, y: -h }, finalMatrix),
      tr: transformPoint({ x: w, y: -h }, finalMatrix),
      bl: transformPoint({ x: -w, y: h }, finalMatrix),
      br: transformPoint({ x: w, y: h }, finalMatrix),
    };
  }

  /**
   * Sets corner and controls position coordinates based on current angle, width and height, left and top.
   * aCoords are used to quickly find an object on the canvas
   * lineCoords are used to quickly find object during pointer events.
   * See {@link https://github.com/fabricjs/fabric.js/wiki/When-to-call-setCoords} and {@link http://fabricjs.com/fabric-gotchas}
   * @param {Boolean} [skipCorners] skip calculation of aCoord, lineCoords.
   * @return {void}
   */
  setCoords(): void {
    this.aCoords = this.calcACoords();
    // in case we are in a group, for how the inner group target check works,
    // lineCoords are exactly aCoords. Since the vpt gets absorbed by the normalized pointer.
    this.lineCoords = this.group ? this.aCoords : this.calcLineCoords();
  }

  // 生成一个字符串类型的键（key），用来在缓存机制中唯一的标识一个特定的变换矩阵。这个键是由对象的多个属性组合而成的
  transformMatrixKey(skipGroup = false): string {
    const sep = '_';
    let prefix = '';

    // 如果对象属于一个群组并且 skipGroup 为 false，则调用群组的 transformMatrixKey 方法并将其值赋给 prefix。skipGroup 参数用于决定是否包含群组的变换
    if (!skipGroup && this.group) {
      prefix = this.group.transformMatrixKey(skipGroup) + sep;
    }

    // 函数返回对象的多个字段（位置、缩放、倾斜、角度、原点、大小等）以及群组的字符串表示拼接而成的字符串，作为变换矩阵在缓存中的键
    return (
      prefix +
      this.top +
      sep +
      this.left +
      sep +
      this.scaleX +
      sep +
      this.scaleY +
      sep +
      this.skewX +
      sep +
      this.skewY +
      sep +
      this.angle +
      sep +
      this.originX +
      sep +
      this.originY +
      sep +
      this.width +
      sep +
      this.height +
      sep +
      this.strokeWidth +
      this.flipX +
      this.flipY
    );
  }

  /**
   * 计算当前对象的变换矩阵
   * calculate transform matrix that represents the current transformations from the
   * object's properties.
   * @param {Boolean} [skipGroup] return transform matrix for object not counting parent transformations
   * There are some situation in which this is useful to avoid the fake rotation.
   * @return {TMat2D} transform matrix for the object
   */
  calcTransformMatrix(skipGroup = false): TMat2D {
    let matrix = this.calcOwnMatrix(); // 计算当前对象自己的变换矩阵
    if (skipGroup || !this.group) {
      // 直接返回对象自己的变换矩阵
      return matrix;
    }

    // 进行群组的变换
    const key = this.transformMatrixKey(skipGroup), // 计算矩阵的关键词(key)
      cache = this.matrixCache; // 缓存中存在对应关键词的矩阵，就直接返回这个矩阵
    if (cache && cache.key === key) {
      return cache.value;
    }

    // 如果这个对象是群组的一部分，就需要计算组的变换矩阵，然后使用 multiplyTransformMatrices 函数和对象自己的矩阵进行矩阵乘法，得到最终的变换矩阵
    if (this.group) {
      matrix = multiplyTransformMatrices(
        this.group.calcTransformMatrix(false),
        matrix
      );
    }

    // 将这个矩阵缓存起来，以便于下次使用，然后返回这个矩阵
    this.matrixCache = {
      key,
      value: matrix,
    };
    return matrix;
  }

  /**
   * 计算当前对象自身的变换矩阵，这个矩阵能描述改对象的属性，如位置、缩放、旋转等。它通常在计算综合变换或者渲染对象时被使用
   * calculate transform matrix that represents the current transformations from the
   * object's properties, this matrix does not include the group transformation
   * @return {TMat2D} transform matrix for the object
   */
  calcOwnMatrix(): TMat2D {
    // 函数计算矩阵的关键字(key)，并尝试从自身的矩阵缓存(ownMatrixCache)中获取已经计算的矩阵。如果找到对应关键字的缓存，则直接返回缓存的矩阵
    const key = this.transformMatrixKey(true),
      cache = this.ownMatrixCache;
    if (cache && cache.key === key) {
      return cache.value;
    }
    // 如果缓存中没有找到，则需要计算矩阵。函数首先获取对象相对于自身中心点的坐标，然后创建一个包含了对象属性的 options 对象，允许用于构成矩阵的函数使用
    const center = this.getRelativeCenterPoint(),
      options = {
        angle: this.angle,
        translateX: center.x,
        translateY: center.y,
        scaleX: this.scaleX,
        scaleY: this.scaleY,
        skewX: this.skewX,
        skewY: this.skewY,
        flipX: this.flipX,
        flipY: this.flipY,
      },
      value = composeMatrix(options); // 将 options 中的变换属性组合成一个变换矩阵。
    // 函数将计算出的矩阵存储到自身矩阵的缓存中，并返回这个矩阵
    this.ownMatrixCache = {
      key,
      value,
    };
    return value;
  }

  /**
   * Calculate object dimensions from its properties
   * @private
   * @returns {Point} dimensions
   */
  _getNonTransformedDimensions(): Point {
    return new Point(this.width, this.height).scalarAdd(this.strokeWidth);
  }

  /**
   * Calculate object dimensions for controls box, including padding and canvas zoom.
   * and active selection
   * @private
   * @param {object} [options] transform options
   * @returns {Point} dimensions
   */
  _calculateCurrentDimensions(options?: any): Point {
    return this._getTransformedDimensions(options)
      .transform(this.getViewportTransform(), true)
      .scalarAdd(2 * this.padding);
  }
}
