import type { XY } from '../../Point';
import { Point } from '../../Point';
import type { TBBox } from '../../typedefs';

/**
 * 根据给定的点集生成一个包含所有这些点的最小边界框
 * 可以处理任意数量的点，并且不依赖于点的顺序或是点的分布。因此，无论点集的情况如何，此函数都能返回一个正确的边界框
 * Calculates bounding box (left, top, width, height) from given `points`
 * @param {XY[]} points
 * @return {Object} Object with left, top, width, height properties
 */
export const makeBoundingBoxFromPoints = (points: XY[]): TBBox => {
  // 如果点集为空，那么直接返回一个左上角坐标为(0,0)且宽度和高度都为0的边界框
  if (points.length === 0) {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  // 如果点集中有一个或多个点，那么首先使用 reduce 函数找到这些点的最小的 x 和 y 坐标（即左上角点）和最大的 x 和 y 坐标（即右下角点）。
  const { min, max } = points.reduce(
    ({ min, max }, curr) => {
      return {
        min: min.min(curr),
        max: max.max(curr),
      };
    },
    { min: new Point(points[0]), max: new Point(points[0]) }
  );

  // 函数计算右下角点和左上角点的差，得到边界框的大小（宽度和高度）
  const size = max.subtract(min);

  return {
    left: min.x,
    top: min.y,
    width: size.x,
    height: size.y,
  };
};
