(function (spine) {
  "use strict";

  if (!spine) throw new Error("spine runtime must be loaded before spine-skeleton-binary-3.6.js");

  var CLIPPING_ATTACHMENT_TYPE = 6;
  var AttachmentTypeValues = [
    spine.AttachmentType.Region,
    spine.AttachmentType.BoundingBox,
    spine.AttachmentType.Mesh,
    spine.AttachmentType.LinkedMesh,
    spine.AttachmentType.Path,
    spine.AttachmentType.Point,
    CLIPPING_ATTACHMENT_TYPE
  ];

  var TransformModeValues = [
    spine.TransformMode.Normal,
    spine.TransformMode.OnlyTranslation,
    spine.TransformMode.NoRotationOrReflection,
    spine.TransformMode.NoScale,
    spine.TransformMode.NoScaleOrReflection
  ];

  var PositionModeValues = [spine.PositionMode.Fixed, spine.PositionMode.Percent];
  var SpacingModeValues = [spine.SpacingMode.Length, spine.SpacingMode.Fixed, spine.SpacingMode.Percent];
  var RotateModeValues = [spine.RotateMode.Tangent, spine.RotateMode.Chain, spine.RotateMode.ChainScale];
  var BlendModeValues = [spine.BlendMode.Normal, spine.BlendMode.Additive, spine.BlendMode.Multiply, spine.BlendMode.Screen];

  function colorFromRgba8888(color, value) {
    color.r = ((value >>> 24) & 0xff) / 255;
    color.g = ((value >>> 16) & 0xff) / 255;
    color.b = ((value >>> 8) & 0xff) / 255;
    color.a = (value & 0xff) / 255;
    return color;
  }

  function colorFromRgb888(color, value) {
    color.r = ((value >>> 16) & 0xff) / 255;
    color.g = ((value >>> 8) & 0xff) / 255;
    color.b = (value & 0xff) / 255;
    color.a = 1;
    return color;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error("SkeletonBinary expects Uint8Array or ArrayBuffer.");
  }

  function BinaryInput(data) {
    this.data = toBytes(data);
    this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    this.index = 0;
  }

  BinaryInput.prototype.readByte = function () {
    return this.view.getInt8(this.index++);
  };

  BinaryInput.prototype.readUnsignedByte = function () {
    return this.view.getUint8(this.index++);
  };

  BinaryInput.prototype.readShort = function () {
    var value = this.view.getUint16(this.index, false);
    this.index += 2;
    return value;
  };

  BinaryInput.prototype.readInt32 = function () {
    var value = this.view.getInt32(this.index, false);
    this.index += 4;
    return value;
  };

  BinaryInput.prototype.readInt = function (optimizePositive) {
    var b = this.readUnsignedByte();
    var result = b & 0x7f;
    if ((b & 0x80) !== 0) {
      b = this.readUnsignedByte();
      result |= (b & 0x7f) << 7;
      if ((b & 0x80) !== 0) {
        b = this.readUnsignedByte();
        result |= (b & 0x7f) << 14;
        if ((b & 0x80) !== 0) {
          b = this.readUnsignedByte();
          result |= (b & 0x7f) << 21;
          if ((b & 0x80) !== 0) {
            b = this.readUnsignedByte();
            result |= (b & 0x7f) << 28;
          }
        }
      }
    }
    return optimizePositive ? result : ((result >>> 1) ^ -(result & 1));
  };

  BinaryInput.prototype.readFloat = function () {
    var value = this.view.getFloat32(this.index, false);
    this.index += 4;
    return value;
  };

  BinaryInput.prototype.readBoolean = function () {
    return this.readByte() !== 0;
  };

  BinaryInput.prototype.readString = function () {
    var byteCount = this.readInt(true);
    switch (byteCount) {
      case 0: return null;
      case 1: return "";
    }

    byteCount--;
    var chars = "";
    for (var i = 0; i < byteCount;) {
      var b = this.readUnsignedByte();
      switch (b >> 4) {
        case 12:
        case 13:
          chars += String.fromCharCode(((b & 0x1f) << 6) | (this.readUnsignedByte() & 0x3f));
          i += 2;
          break;
        case 14:
          chars += String.fromCharCode(((b & 0x0f) << 12) | ((this.readUnsignedByte() & 0x3f) << 6) | (this.readUnsignedByte() & 0x3f));
          i += 3;
          break;
        default:
          chars += String.fromCharCode(b);
          i++;
      }
    }
    return chars;
  };

  function Vertices() {
    this.bones = null;
    this.vertices = null;
  }

  function LinkedMesh(mesh, skin, slotIndex, parent, inheritDeform) {
    this.mesh = mesh;
    this.skin = skin;
    this.slotIndex = slotIndex;
    this.parent = parent;
    this.inheritDeform = inheritDeform;
  }

  function SkeletonBinary(attachmentLoader) {
    this.scale = 1;
    this.attachmentLoader = attachmentLoader;
    this.linkedMeshes = [];
  }

  SkeletonBinary.prototype.readSkeletonData = function (binary) {
    var input = new BinaryInput(binary);
    var scale = this.scale;
    var skeletonData = new spine.SkeletonData();

    skeletonData.hash = input.readString();
    skeletonData.version = input.readString();
    skeletonData.width = input.readFloat();
    skeletonData.height = input.readFloat();

    var nonessential = input.readBoolean();
    if (nonessential) {
      skeletonData.fps = input.readFloat();
      skeletonData.imagesPath = input.readString();
    }

    var n = input.readInt(true);
    for (var i = 0; i < n; i++) {
      var name = input.readString();
      var parent = i === 0 ? null : skeletonData.bones[input.readInt(true)];
      var bone = new spine.BoneData(i, name, parent);
      bone.rotation = input.readFloat();
      bone.x = input.readFloat() * scale;
      bone.y = input.readFloat() * scale;
      bone.scaleX = input.readFloat();
      bone.scaleY = input.readFloat();
      bone.shearX = input.readFloat();
      bone.shearY = input.readFloat();
      bone.length = input.readFloat() * scale;
      bone.transformMode = TransformModeValues[input.readInt(true)];
      if (nonessential) colorFromRgba8888(bone.color || (bone.color = new spine.Color(1, 1, 1, 1)), input.readInt32());
      skeletonData.bones.push(bone);
    }

    n = input.readInt(true);
    for (var s = 0; s < n; s++) {
      var slotName = input.readString();
      var boneData = skeletonData.bones[input.readInt(true)];
      var slot = new spine.SlotData(s, slotName, boneData);
      colorFromRgba8888(slot.color, input.readInt32());
      var darkColor = input.readInt32();
      if (darkColor !== -1) colorFromRgb888(slot.darkColor = new spine.Color(), darkColor);
      slot.attachmentName = input.readString();
      slot.blendMode = BlendModeValues[input.readInt(true)];
      skeletonData.slots.push(slot);
    }

    n = input.readInt(true);
    for (var ik = 0; ik < n; ik++) {
      var ikData = new spine.IkConstraintData(input.readString());
      ikData.order = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) ikData.bones.push(skeletonData.bones[input.readInt(true)]);
      ikData.target = skeletonData.bones[input.readInt(true)];
      ikData.mix = input.readFloat();
      ikData.bendDirection = input.readByte();
      skeletonData.ikConstraints.push(ikData);
    }

    n = input.readInt(true);
    for (var tc = 0; tc < n; tc++) {
      var transform = new spine.TransformConstraintData(input.readString());
      transform.order = input.readInt(true);
      for (var tb = 0, tbn = input.readInt(true); tb < tbn; tb++) transform.bones.push(skeletonData.bones[input.readInt(true)]);
      transform.target = skeletonData.bones[input.readInt(true)];
      transform.local = input.readBoolean();
      transform.relative = input.readBoolean();
      transform.offsetRotation = input.readFloat();
      transform.offsetX = input.readFloat() * scale;
      transform.offsetY = input.readFloat() * scale;
      transform.offsetScaleX = input.readFloat();
      transform.offsetScaleY = input.readFloat();
      transform.offsetShearY = input.readFloat();
      transform.rotateMix = input.readFloat();
      transform.translateMix = input.readFloat();
      transform.scaleMix = input.readFloat();
      transform.shearMix = input.readFloat();
      skeletonData.transformConstraints.push(transform);
    }

    n = input.readInt(true);
    for (var pc = 0; pc < n; pc++) {
      var path = new spine.PathConstraintData(input.readString());
      path.order = input.readInt(true);
      for (var pb = 0, pbn = input.readInt(true); pb < pbn; pb++) path.bones.push(skeletonData.bones[input.readInt(true)]);
      path.target = skeletonData.slots[input.readInt(true)];
      path.positionMode = PositionModeValues[input.readInt(true)];
      path.spacingMode = SpacingModeValues[input.readInt(true)];
      path.rotateMode = RotateModeValues[input.readInt(true)];
      path.offsetRotation = input.readFloat();
      path.position = input.readFloat();
      if (path.positionMode === spine.PositionMode.Fixed) path.position *= scale;
      path.spacing = input.readFloat();
      if (path.spacingMode === spine.SpacingMode.Length || path.spacingMode === spine.SpacingMode.Fixed) path.spacing *= scale;
      path.rotateMix = input.readFloat();
      path.translateMix = input.readFloat();
      skeletonData.pathConstraints.push(path);
    }

    var defaultSkin = this.readSkin(input, "default", true, skeletonData, nonessential);
    if (defaultSkin) {
      skeletonData.defaultSkin = defaultSkin;
      skeletonData.skins.push(defaultSkin);
    }

    n = input.readInt(true);
    for (var skinIndex = 0; skinIndex < n; skinIndex++) {
      var skinName = input.readString();
      var skin = this.readSkin(input, skinName, false, skeletonData, nonessential);
      if (skin) skeletonData.skins.push(skin);
    }

    for (var lm = 0; lm < this.linkedMeshes.length; lm++) {
      var linkedMesh = this.linkedMeshes[lm];
      var skin = linkedMesh.skin == null ? skeletonData.defaultSkin : skeletonData.findSkin(linkedMesh.skin);
      if (skin == null) throw new Error("Skin not found: " + linkedMesh.skin);
      var parentMesh = skin.getAttachment(linkedMesh.slotIndex, linkedMesh.parent);
      if (parentMesh == null) throw new Error("Parent mesh not found: " + linkedMesh.parent);
      linkedMesh.mesh.inheritDeform = linkedMesh.inheritDeform;
      linkedMesh.mesh.setParentMesh(parentMesh);
      linkedMesh.mesh.updateUVs();
    }
    this.linkedMeshes.length = 0;

    n = input.readInt(true);
    for (var e = 0; e < n; e++) {
      var eventData = new spine.EventData(input.readString());
      eventData.intValue = input.readInt(false);
      eventData.floatValue = input.readFloat();
      eventData.stringValue = input.readString();
      skeletonData.events.push(eventData);
    }

    n = input.readInt(true);
    for (var a = 0; a < n; a++) {
      skeletonData.animations.push(this.readAnimation(input, input.readString(), skeletonData));
    }

    return skeletonData;
  };

  SkeletonBinary.prototype.readSkin = function (input, skinName, defaultSkin, skeletonData, nonessential) {
    var slotCount = input.readInt(true);
    if (slotCount === 0) return null;
    var skin = new spine.Skin(skinName);
    for (var i = 0; i < slotCount; i++) {
      var slotIndex = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var name = input.readString();
        var attachment = this.readAttachment(input, skeletonData, skin, slotIndex, name, nonessential);
        if (attachment != null) skin.addAttachment(slotIndex, name, attachment);
      }
    }
    return skin;
  };

  SkeletonBinary.prototype.readAttachment = function (input, skeletonData, skin, slotIndex, attachmentName, nonessential) {
    var scale = this.scale;
    var name = input.readString();
    if (name == null) name = attachmentName;
    var type = AttachmentTypeValues[input.readByte()];

    switch (type) {
      case spine.AttachmentType.Region: {
        var regionPath = input.readString();
        var rotation = input.readFloat();
        var x = input.readFloat();
        var y = input.readFloat();
        var scaleX = input.readFloat();
        var scaleY = input.readFloat();
        var width = input.readFloat();
        var height = input.readFloat();
        var regionColor = input.readInt32();
        if (regionPath == null) regionPath = name;
        var region = this.attachmentLoader.newRegionAttachment(skin, name, regionPath);
        if (region == null) return null;
        region.path = regionPath;
        region.x = x * scale;
        region.y = y * scale;
        region.scaleX = scaleX;
        region.scaleY = scaleY;
        region.rotation = rotation;
        region.width = width * scale;
        region.height = height * scale;
        colorFromRgba8888(region.color, regionColor);
        region.updateOffset();
        return region;
      }
      case spine.AttachmentType.BoundingBox: {
        var boxVertexCount = input.readInt(true);
        var boxVertices = this.readVertices(input, boxVertexCount);
        var boxColor = nonessential ? input.readInt32() : 0;
        var box = this.attachmentLoader.newBoundingBoxAttachment(skin, name);
        if (box == null) return null;
        box.worldVerticesLength = boxVertexCount << 1;
        box.vertices = boxVertices.vertices;
        box.bones = boxVertices.bones;
        if (nonessential) colorFromRgba8888(box.color, boxColor);
        return box;
      }
      case spine.AttachmentType.Mesh: {
        var meshPath = input.readString();
        var meshColor = input.readInt32();
        var vertexCount = input.readInt(true);
        var uvs = this.readFloatArray(input, vertexCount << 1, 1);
        var triangles = this.readShortArray(input);
        var vertices = this.readVertices(input, vertexCount);
        var hullLength = input.readInt(true);
        var edges = null;
        var meshWidth = 0;
        var meshHeight = 0;
        if (nonessential) {
          edges = this.readShortArray(input);
          meshWidth = input.readFloat();
          meshHeight = input.readFloat();
        }
        if (meshPath == null) meshPath = name;
        var mesh = this.attachmentLoader.newMeshAttachment(skin, name, meshPath);
        if (mesh == null) return null;
        mesh.path = meshPath;
        colorFromRgba8888(mesh.color, meshColor);
        mesh.bones = vertices.bones;
        mesh.vertices = vertices.vertices;
        mesh.worldVerticesLength = vertexCount << 1;
        mesh.triangles = triangles;
        mesh.regionUVs = uvs;
        mesh.updateUVs();
        mesh.hullLength = hullLength << 1;
        if (nonessential) {
          mesh.edges = edges;
          mesh.width = meshWidth * scale;
          mesh.height = meshHeight * scale;
        }
        return mesh;
      }
      case spine.AttachmentType.LinkedMesh: {
        var linkedPath = input.readString();
        var linkedColor = input.readInt32();
        var skinName = input.readString();
        var parent = input.readString();
        var inheritDeform = input.readBoolean();
        var linkedWidth = 0;
        var linkedHeight = 0;
        if (nonessential) {
          linkedWidth = input.readFloat();
          linkedHeight = input.readFloat();
        }
        if (linkedPath == null) linkedPath = name;
        var linked = this.attachmentLoader.newMeshAttachment(skin, name, linkedPath);
        if (linked == null) return null;
        linked.path = linkedPath;
        colorFromRgba8888(linked.color, linkedColor);
        if (nonessential) {
          linked.width = linkedWidth * scale;
          linked.height = linkedHeight * scale;
        }
        this.linkedMeshes.push(new LinkedMesh(linked, skinName, slotIndex, parent, inheritDeform));
        return linked;
      }
      case spine.AttachmentType.Path: {
        var closed = input.readBoolean();
        var constantSpeed = input.readBoolean();
        var pathVertexCount = input.readInt(true);
        var pathVertices = this.readVertices(input, pathVertexCount);
        var lengths = spine.Utils.newArray(pathVertexCount / 3, 0);
        for (var l = 0; l < lengths.length; l++) lengths[l] = input.readFloat() * scale;
        var pathColor = nonessential ? input.readInt32() : 0;
        var pathAttachment = this.attachmentLoader.newPathAttachment(skin, name);
        if (pathAttachment == null) return null;
        pathAttachment.closed = closed;
        pathAttachment.constantSpeed = constantSpeed;
        pathAttachment.worldVerticesLength = pathVertexCount << 1;
        pathAttachment.vertices = pathVertices.vertices;
        pathAttachment.bones = pathVertices.bones;
        pathAttachment.lengths = lengths;
        if (nonessential) colorFromRgba8888(pathAttachment.color, pathColor);
        return pathAttachment;
      }
      case spine.AttachmentType.Point: {
        var pointRotation = input.readFloat();
        var pointX = input.readFloat();
        var pointY = input.readFloat();
        var pointColor = nonessential ? input.readInt32() : 0;
        var point = this.attachmentLoader.newPointAttachment(skin, name);
        if (point == null) return null;
        point.rotation = pointRotation;
        point.x = pointX * scale;
        point.y = pointY * scale;
        if (nonessential) colorFromRgba8888(point.color, pointColor);
        return point;
      }
      case CLIPPING_ATTACHMENT_TYPE: {
        var endSlotIndex = input.readInt(true);
        var clipVertexCount = input.readInt(true);
        var clipVertices = this.readVertices(input, clipVertexCount);
        var clipColor = nonessential ? input.readInt32() : 0;
        var clip = this.attachmentLoader.newClippingAttachment(skin, name);
        if (clip == null) return null;
        clip.endSlot = skeletonData.slots[endSlotIndex];
        clip.worldVerticesLength = clipVertexCount << 1;
        clip.vertices = clipVertices.vertices;
        clip.bones = clipVertices.bones;
        if (nonessential) colorFromRgba8888(clip.color, clipColor);
        return clip;
      }
    }

    return null;
  };

  SkeletonBinary.prototype.readVertices = function (input, vertexCount) {
    var verticesLength = vertexCount << 1;
    var vertices = new Vertices();
    var scale = this.scale;
    if (!input.readBoolean()) {
      vertices.vertices = this.readFloatArray(input, verticesLength, scale);
      return vertices;
    }

    var weights = [];
    var bones = [];
    for (var i = 0; i < vertexCount; i++) {
      var boneCount = input.readInt(true);
      bones.push(boneCount);
      for (var ii = 0; ii < boneCount; ii++) {
        bones.push(input.readInt(true));
        weights.push(input.readFloat() * scale);
        weights.push(input.readFloat() * scale);
        weights.push(input.readFloat());
      }
    }
    vertices.vertices = spine.Utils.toFloatArray(weights);
    vertices.bones = bones;
    return vertices;
  };

  SkeletonBinary.prototype.readFloatArray = function (input, n, scale) {
    var array = new Array(n);
    if (scale === 1) {
      for (var i = 0; i < n; i++) array[i] = input.readFloat();
    } else {
      for (var ii = 0; ii < n; ii++) array[ii] = input.readFloat() * scale;
    }
    return array;
  };

  SkeletonBinary.prototype.readShortArray = function (input) {
    var n = input.readInt(true);
    var array = new Array(n);
    for (var i = 0; i < n; i++) array[i] = input.readShort();
    return array;
  };

  SkeletonBinary.prototype.readAnimation = function (input, name, skeletonData) {
    var timelines = [];
    var scale = this.scale;
    var duration = 0;
    var color = new spine.Color();
    var light = new spine.Color();
    var dark = new spine.Color();

    for (var i = 0, n = input.readInt(true); i < n; i++) {
      var slotIndex = input.readInt(true);
      for (var ii = 0, nn = input.readInt(true); ii < nn; ii++) {
        var slotTimelineType = input.readByte();
        var slotFrameCount = input.readInt(true);
        switch (slotTimelineType) {
          case SkeletonBinary.SLOT_ATTACHMENT: {
            var attachmentTimeline = new spine.AttachmentTimeline(slotFrameCount);
            attachmentTimeline.slotIndex = slotIndex;
            for (var frameIndex = 0; frameIndex < slotFrameCount; frameIndex++) {
              attachmentTimeline.setFrame(frameIndex, input.readFloat(), input.readString());
            }
            timelines.push(attachmentTimeline);
            duration = Math.max(duration, attachmentTimeline.frames[slotFrameCount - 1]);
            break;
          }
          case SkeletonBinary.SLOT_COLOR: {
            var colorTimeline = new spine.ColorTimeline(slotFrameCount);
            colorTimeline.slotIndex = slotIndex;
            for (var colorFrame = 0; colorFrame < slotFrameCount; colorFrame++) {
              var colorTime = input.readFloat();
              colorFromRgba8888(color, input.readInt32());
              colorTimeline.setFrame(colorFrame, colorTime, color.r, color.g, color.b, color.a);
              if (colorFrame < slotFrameCount - 1) this.readCurve(input, colorFrame, colorTimeline);
            }
            timelines.push(colorTimeline);
            duration = Math.max(duration, colorTimeline.frames[(slotFrameCount - 1) * spine.ColorTimeline.ENTRIES]);
            break;
          }
          case SkeletonBinary.SLOT_TWO_COLOR: {
            var twoColorTimeline = new spine.TwoColorTimeline(slotFrameCount);
            twoColorTimeline.slotIndex = slotIndex;
            for (var twoColorFrame = 0; twoColorFrame < slotFrameCount; twoColorFrame++) {
              var twoColorTime = input.readFloat();
              colorFromRgba8888(light, input.readInt32());
              colorFromRgb888(dark, input.readInt32());
              twoColorTimeline.setFrame(twoColorFrame, twoColorTime, light.r, light.g, light.b, light.a, dark.r, dark.g, dark.b);
              if (twoColorFrame < slotFrameCount - 1) this.readCurve(input, twoColorFrame, twoColorTimeline);
            }
            timelines.push(twoColorTimeline);
            duration = Math.max(duration, twoColorTimeline.frames[(slotFrameCount - 1) * spine.TwoColorTimeline.ENTRIES]);
            break;
          }
        }
      }
    }

    for (var b = 0, bn = input.readInt(true); b < bn; b++) {
      var boneIndex = input.readInt(true);
      for (var bt = 0, btn = input.readInt(true); bt < btn; bt++) {
        var boneTimelineType = input.readByte();
        var boneFrameCount = input.readInt(true);
        switch (boneTimelineType) {
          case SkeletonBinary.BONE_ROTATE: {
            var rotate = new spine.RotateTimeline(boneFrameCount);
            rotate.boneIndex = boneIndex;
            for (var rotateFrame = 0; rotateFrame < boneFrameCount; rotateFrame++) {
              rotate.setFrame(rotateFrame, input.readFloat(), input.readFloat());
              if (rotateFrame < boneFrameCount - 1) this.readCurve(input, rotateFrame, rotate);
            }
            timelines.push(rotate);
            duration = Math.max(duration, rotate.frames[(boneFrameCount - 1) * spine.RotateTimeline.ENTRIES]);
            break;
          }
          case SkeletonBinary.BONE_TRANSLATE:
          case SkeletonBinary.BONE_SCALE:
          case SkeletonBinary.BONE_SHEAR: {
            var timeline;
            var timelineScale = 1;
            if (boneTimelineType === SkeletonBinary.BONE_SCALE) timeline = new spine.ScaleTimeline(boneFrameCount);
            else if (boneTimelineType === SkeletonBinary.BONE_SHEAR) timeline = new spine.ShearTimeline(boneFrameCount);
            else {
              timeline = new spine.TranslateTimeline(boneFrameCount);
              timelineScale = scale;
            }
            timeline.boneIndex = boneIndex;
            for (var translateFrame = 0; translateFrame < boneFrameCount; translateFrame++) {
              timeline.setFrame(translateFrame, input.readFloat(), input.readFloat() * timelineScale, input.readFloat() * timelineScale);
              if (translateFrame < boneFrameCount - 1) this.readCurve(input, translateFrame, timeline);
            }
            timelines.push(timeline);
            duration = Math.max(duration, timeline.frames[(boneFrameCount - 1) * spine.TranslateTimeline.ENTRIES]);
            break;
          }
        }
      }
    }

    for (var ik = 0, ikn = input.readInt(true); ik < ikn; ik++) {
      var ikIndex = input.readInt(true);
      var ikFrameCount = input.readInt(true);
      var ikTimeline = new spine.IkConstraintTimeline(ikFrameCount);
      ikTimeline.ikConstraintIndex = ikIndex;
      for (var ikFrame = 0; ikFrame < ikFrameCount; ikFrame++) {
        ikTimeline.setFrame(ikFrame, input.readFloat(), input.readFloat(), input.readByte());
        if (ikFrame < ikFrameCount - 1) this.readCurve(input, ikFrame, ikTimeline);
      }
      timelines.push(ikTimeline);
      duration = Math.max(duration, ikTimeline.frames[(ikFrameCount - 1) * spine.IkConstraintTimeline.ENTRIES]);
    }

    for (var tc = 0, tcn = input.readInt(true); tc < tcn; tc++) {
      var transformIndex = input.readInt(true);
      var transformFrameCount = input.readInt(true);
      var transformTimeline = new spine.TransformConstraintTimeline(transformFrameCount);
      transformTimeline.transformConstraintIndex = transformIndex;
      for (var transformFrame = 0; transformFrame < transformFrameCount; transformFrame++) {
        transformTimeline.setFrame(transformFrame, input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat());
        if (transformFrame < transformFrameCount - 1) this.readCurve(input, transformFrame, transformTimeline);
      }
      timelines.push(transformTimeline);
      duration = Math.max(duration, transformTimeline.frames[(transformFrameCount - 1) * spine.TransformConstraintTimeline.ENTRIES]);
    }

    for (var pc = 0, pcn = input.readInt(true); pc < pcn; pc++) {
      var pathIndex = input.readInt(true);
      var pathData = skeletonData.pathConstraints[pathIndex];
      for (var pt = 0, ptn = input.readInt(true); pt < ptn; pt++) {
        var pathTimelineType = input.readByte();
        var pathFrameCount = input.readInt(true);
        switch (pathTimelineType) {
          case SkeletonBinary.PATH_POSITION:
          case SkeletonBinary.PATH_SPACING: {
            var pathTimeline;
            var pathTimelineScale = 1;
            if (pathTimelineType === SkeletonBinary.PATH_SPACING) {
              pathTimeline = new spine.PathConstraintSpacingTimeline(pathFrameCount);
              if (pathData.spacingMode === spine.SpacingMode.Length || pathData.spacingMode === spine.SpacingMode.Fixed) pathTimelineScale = scale;
            } else {
              pathTimeline = new spine.PathConstraintPositionTimeline(pathFrameCount);
              if (pathData.positionMode === spine.PositionMode.Fixed) pathTimelineScale = scale;
            }
            pathTimeline.pathConstraintIndex = pathIndex;
            for (var pathFrame = 0; pathFrame < pathFrameCount; pathFrame++) {
              pathTimeline.setFrame(pathFrame, input.readFloat(), input.readFloat() * pathTimelineScale);
              if (pathFrame < pathFrameCount - 1) this.readCurve(input, pathFrame, pathTimeline);
            }
            timelines.push(pathTimeline);
            duration = Math.max(duration, pathTimeline.frames[(pathFrameCount - 1) * spine.PathConstraintPositionTimeline.ENTRIES]);
            break;
          }
          case SkeletonBinary.PATH_MIX: {
            var pathMixTimeline = new spine.PathConstraintMixTimeline(pathFrameCount);
            pathMixTimeline.pathConstraintIndex = pathIndex;
            for (var pathMixFrame = 0; pathMixFrame < pathFrameCount; pathMixFrame++) {
              pathMixTimeline.setFrame(pathMixFrame, input.readFloat(), input.readFloat(), input.readFloat());
              if (pathMixFrame < pathFrameCount - 1) this.readCurve(input, pathMixFrame, pathMixTimeline);
            }
            timelines.push(pathMixTimeline);
            duration = Math.max(duration, pathMixTimeline.frames[(pathFrameCount - 1) * spine.PathConstraintMixTimeline.ENTRIES]);
            break;
          }
        }
      }
    }

    for (var ffd = 0, ffdn = input.readInt(true); ffd < ffdn; ffd++) {
      var skin = skeletonData.skins[input.readInt(true)];
      for (var ffdSlot = 0, ffdSlotCount = input.readInt(true); ffdSlot < ffdSlotCount; ffdSlot++) {
        var slotIndex = input.readInt(true);
        for (var ffdAttachment = 0, ffdAttachmentCount = input.readInt(true); ffdAttachment < ffdAttachmentCount; ffdAttachment++) {
          var attachment = skin.getAttachment(slotIndex, input.readString());
          if (!attachment) throw new Error("FFD attachment not found for slot " + slotIndex + " in skin " + skin.name + ".");
          var weighted = attachment.bones != null;
          var vertices = attachment.vertices;
          var deformLength = weighted ? vertices.length / 3 * 2 : vertices.length;
          var deformFrameCount = input.readInt(true);
          var deformTimeline = new spine.DeformTimeline(deformFrameCount);
          deformTimeline.slotIndex = slotIndex;
          deformTimeline.attachment = attachment;
          for (var deformFrame = 0; deformFrame < deformFrameCount; deformFrame++) {
            var time = input.readFloat();
            var deform;
            var end = input.readInt(true);
            if (end === 0) {
              deform = weighted ? spine.Utils.newFloatArray(deformLength) : vertices;
            } else {
              deform = spine.Utils.newFloatArray(deformLength);
              var start = input.readInt(true);
              end += start;
              for (var v = start; v < end; v++) deform[v] = input.readFloat() * scale;
              if (!weighted) {
                for (var vn = deform.length, vv = 0; vv < vn; vv++) deform[vv] += vertices[vv];
              }
            }
            deformTimeline.setFrame(deformFrame, time, deform);
            if (deformFrame < deformFrameCount - 1) this.readCurve(input, deformFrame, deformTimeline);
          }
          timelines.push(deformTimeline);
          duration = Math.max(duration, deformTimeline.frames[deformFrameCount - 1]);
        }
      }
    }

    var drawOrderCount = input.readInt(true);
    if (drawOrderCount > 0) {
      var drawOrderTimeline = new spine.DrawOrderTimeline(drawOrderCount);
      var slotCount = skeletonData.slots.length;
      for (var drawOrderFrame = 0; drawOrderFrame < drawOrderCount; drawOrderFrame++) {
        var drawOrderTime = input.readFloat();
        var offsetCount = input.readInt(true);
        var drawOrder = spine.Utils.newArray(slotCount, -1);
        var unchanged = spine.Utils.newArray(slotCount - offsetCount, 0);
        var originalIndex = 0;
        var unchangedIndex = 0;
        for (var offset = 0; offset < offsetCount; offset++) {
          var drawSlotIndex = input.readInt(true);
          while (originalIndex !== drawSlotIndex) unchanged[unchangedIndex++] = originalIndex++;
          drawOrder[originalIndex + input.readInt(true)] = originalIndex++;
        }
        while (originalIndex < slotCount) unchanged[unchangedIndex++] = originalIndex++;
        for (var drawOrderIndex = slotCount - 1; drawOrderIndex >= 0; drawOrderIndex--) {
          if (drawOrder[drawOrderIndex] === -1) drawOrder[drawOrderIndex] = unchanged[--unchangedIndex];
        }
        drawOrderTimeline.setFrame(drawOrderFrame, drawOrderTime, drawOrder);
      }
      timelines.push(drawOrderTimeline);
      duration = Math.max(duration, drawOrderTimeline.frames[drawOrderCount - 1]);
    }

    var eventCount = input.readInt(true);
    if (eventCount > 0) {
      var eventTimeline = new spine.EventTimeline(eventCount);
      for (var eventFrame = 0; eventFrame < eventCount; eventFrame++) {
        var eventTime = input.readFloat();
        var eventData = skeletonData.events[input.readInt(true)];
        var event = new spine.Event(eventTime, eventData);
        event.intValue = input.readInt(false);
        event.floatValue = input.readFloat();
        event.stringValue = input.readBoolean() ? input.readString() : eventData.stringValue;
        eventTimeline.setFrame(eventFrame, event);
      }
      timelines.push(eventTimeline);
      duration = Math.max(duration, eventTimeline.frames[eventCount - 1]);
    }

    return new spine.Animation(name, timelines, duration);
  };

  SkeletonBinary.prototype.readCurve = function (input, frameIndex, timeline) {
    switch (input.readByte()) {
      case SkeletonBinary.CURVE_STEPPED:
        timeline.setStepped(frameIndex);
        break;
      case SkeletonBinary.CURVE_BEZIER:
        timeline.setCurve(frameIndex, input.readFloat(), input.readFloat(), input.readFloat(), input.readFloat());
        break;
    }
  };

  SkeletonBinary.BONE_ROTATE = 0;
  SkeletonBinary.BONE_TRANSLATE = 1;
  SkeletonBinary.BONE_SCALE = 2;
  SkeletonBinary.BONE_SHEAR = 3;
  SkeletonBinary.SLOT_ATTACHMENT = 0;
  SkeletonBinary.SLOT_COLOR = 1;
  SkeletonBinary.SLOT_TWO_COLOR = 2;
  SkeletonBinary.PATH_POSITION = 0;
  SkeletonBinary.PATH_SPACING = 1;
  SkeletonBinary.PATH_MIX = 2;
  SkeletonBinary.CURVE_LINEAR = 0;
  SkeletonBinary.CURVE_STEPPED = 1;
  SkeletonBinary.CURVE_BEZIER = 2;

  spine.SkeletonBinary = SkeletonBinary;
  spine.BinaryInput36 = BinaryInput;

  var AssetManager = spine.webgl && spine.webgl.AssetManager ? spine.webgl.AssetManager : spine.AssetManager;
  if (AssetManager && !AssetManager.prototype.loadBinary) {
    AssetManager.prototype.loadBinary = function (path, success, error) {
      var self = this;
      if (success === void 0) success = null;
      if (error === void 0) error = null;
      path = this.pathPrefix + path;
      this.toLoad++;
      AssetManager.downloadBinary(path, function (data) {
        self.assets[path] = data;
        if (success) success(path, data);
        self.toLoad--;
        self.loaded++;
      }, function (state, responseText) {
        self.errors[path] = "Couldn't load binary " + path + ": status " + state + ", " + responseText;
        if (error) error(path, self.errors[path]);
        self.toLoad--;
        self.loaded++;
      });
    };
  }
})(spine);
