(() => {
  const canvas = document.getElementById("scene-webgl");
  if (!canvas) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const revealItems = [...document.querySelectorAll("[data-reveal]")];
  if (revealItems.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px",
      }
    );

    revealItems.forEach((item) => observer.observe(item));
  }

  if (prefersReducedMotion.matches) {
    return;
  }

  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
  });

  if (!gl) {
    return;
  }

  const vertexShaderSource = `
    attribute vec2 a_position;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_pointer;
    uniform float u_scroll;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;

      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(12.3, 7.1);
        amplitude *= 0.52;
      }

      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / u_resolution.y;

      float t = u_time * 0.08;
      float scroll = u_scroll;

      vec2 pointer = u_pointer * 2.0 - 1.0;
      pointer.x *= u_resolution.x / u_resolution.y;

      float layerA = fbm(p * 1.2 + vec2(t * 0.7, -t * 0.3));
      float layerB = fbm(p * 2.1 + vec2(-t * 0.55, t * 0.45));
      float flow = fbm(p * 3.0 + vec2(t * 0.25 + scroll * 1.7, -t * 0.2));

      float contourA = smoothstep(
        0.82,
        0.98,
        sin((layerA * 5.4 + p.y * 1.8 - t * 2.1 + scroll * 2.6) * 3.14159) * 0.5 + 0.5
      );

      float contourB = smoothstep(
        0.84,
        0.985,
        sin((layerB * 6.6 - p.x * 1.35 + t * 1.9) * 3.14159) * 0.5 + 0.5
      );

      float haloA = smoothstep(1.35, 0.0, length(p - vec2(-0.38 + scroll * 0.22, 0.12)));
      float haloB = smoothstep(1.08, 0.0, length(p - vec2(0.42, -0.22)));
      float pointerGlow = smoothstep(0.92, 0.0, length(p - pointer * 0.44));

      vec3 base = vec3(0.012, 0.024, 0.045);
      vec3 cyan = vec3(0.55, 0.89, 1.0);
      vec3 mint = vec3(0.43, 0.96, 0.76);

      vec3 color = base;
      color += cyan * haloA * 0.18;
      color += mint * haloB * 0.12;
      color += mix(cyan, mint, flow) * contourA * 0.045;
      color += mix(mint, cyan, layerB) * contourB * 0.038;
      color += mix(cyan, mint, flow) * pointerGlow * 0.14;

      float vignette = smoothstep(1.42, 0.24, length(p));
      color *= 0.72 + vignette * 0.4;

      float alpha = vignette * 0.78 + 0.08;
      gl_FragColor = vec4(color, alpha);
    }
  `;

  const compileShader = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create shader.");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) ?? "Shader compilation failed.";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  };

  const createProgram = (vertexSource, fragmentSource) => {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();

    if (!program) {
      throw new Error("Unable to create program.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? "Program link failed.";
      gl.deleteProgram(program);
      throw new Error(message);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  };

  let program;

  try {
    program = createProgram(vertexShaderSource, fragmentShaderSource);
  } catch (error) {
    console.error(error);
    return;
  }

  const positionAttribute = gl.getAttribLocation(program, "a_position");
  const resolutionUniform = gl.getUniformLocation(program, "u_resolution");
  const timeUniform = gl.getUniformLocation(program, "u_time");
  const pointerUniform = gl.getUniformLocation(program, "u_pointer");
  const scrollUniform = gl.getUniformLocation(program, "u_scroll");

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]),
    gl.STATIC_DRAW
  );

  gl.useProgram(program);
  gl.enableVertexAttribArray(positionAttribute);
  gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);

  const pointerTarget = { x: 0.72, y: 0.34 };
  const pointerCurrent = { x: 0.72, y: 0.34 };
  let scrollTarget = 0;
  let scrollCurrent = 0;
  let frameId = 0;
  let running = true;

  const resize = () => {
    const width = Math.max(1, Math.floor(window.innerWidth * window.devicePixelRatio));
    const height = Math.max(1, Math.floor(window.innerHeight * window.devicePixelRatio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const updatePointer = (clientX, clientY) => {
    pointerTarget.x = clientX / window.innerWidth;
    pointerTarget.y = 1 - clientY / window.innerHeight;
  };

  const updateScroll = () => {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    scrollTarget = window.scrollY / maxScroll;
  };

  const onPointerMove = (event) => {
    updatePointer(event.clientX, event.clientY);
  };

  const onPointerLeave = () => {
    pointerTarget.x = 0.72;
    pointerTarget.y = 0.34;
  };

  const render = (time) => {
    if (!running) {
      return;
    }

    resize();

    pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.045;
    pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.045;
    scrollCurrent += (scrollTarget - scrollCurrent) * 0.04;

    gl.useProgram(program);
    gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
    gl.uniform1f(timeUniform, time * 0.001);
    gl.uniform2f(pointerUniform, pointerCurrent.x, pointerCurrent.y);
    gl.uniform1f(scrollUniform, scrollCurrent);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    frameId = window.requestAnimationFrame(render);
  };

  const onVisibilityChange = () => {
    running = !document.hidden;

    if (running) {
      frameId = window.requestAnimationFrame(render);
    } else {
      window.cancelAnimationFrame(frameId);
    }
  };

  resize();
  updateScroll();
  canvas.classList.add("is-ready");

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerleave", onPointerLeave, { passive: true });
  window.addEventListener("scroll", updateScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);

  frameId = window.requestAnimationFrame(render);
})();
