import {
  BooleanNumber,
  DrawingTypeEnum,
  ImageSourceType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  WrapTextType,
  type IDocumentData,
} from "@univerjs/presets";

import type { DocumentImage } from "../model";

/** Map a conventional embedded image into Univer's complete drawing contract.
 * Omitting the wrapping/distance flags leaves a correctly sized hole in the
 * page while some renderer paths fail to paint the image. */
export function documentImageDrawing(
  documentId: string,
  image: DocumentImage,
): NonNullable<IDocumentData["drawings"]>[string] {
  return {
    drawingId: image.id,
    drawingType: DrawingTypeEnum.DRAWING_IMAGE,
    imageSourceType: ImageSourceType.BASE64,
    source: `data:${image.mimeType};base64,${image.base64}`,
    unitId: documentId,
    subUnitId: documentId,
    title: image.name,
    description: image.alt ?? image.name,
    docTransform: {
      size: { width: image.widthPx, height: image.heightPx },
      positionH: { relativeFrom: ObjectRelativeFromH.COLUMN, posOffset: 0 },
      positionV: { relativeFrom: ObjectRelativeFromV.PARAGRAPH, posOffset: 0 },
      angle: 0,
    },
    layoutType: PositionedObjectLayoutType.INLINE,
    behindDoc: BooleanNumber.FALSE,
    wrapText: WrapTextType.BOTH_SIDES,
    distB: 0,
    distL: 0,
    distR: 0,
    distT: 0,
    transform: {
      left: 0,
      top: 0,
      width: image.widthPx,
      height: image.heightPx,
      angle: 0,
    },
  } as NonNullable<IDocumentData["drawings"]>[string];
}
